import { test, expect } from './zoo-test'
import * as fsp from 'fs/promises'
import { join } from 'path'

const FEATURE_TREE_EXAMPLE_CODE = `export fn timesFive(x) {
  return 5 * x
}
export fn triangle() {
  return startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> xLine(10, %)
    |> line([-10, -5], %)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)
}

length001 = timesFive(1) * 5
sketch001 = startSketchOn('XZ')
  |> startProfileAt([20, 10], %)
  |> line([10, 10], %)
  |> angledLine([-45, length001], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
revolve001 = revolve({ axis = "X" }, sketch001)
triangle()
  |> extrude(30, %)
plane001 = offsetPlane('XY', 10)
sketch002 = startSketchOn(plane001)
  |> startProfileAt([-20, 0], %)
  |> line([5, -15], %)
  |> xLine(-10, %)
  |> lineTo([-40, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(10, sketch002)
`

test.describe('Feature Tree pane', () => {
  test(
    'User can go to definition and go to function definition',
    { tag: '@electron' },
    async ({ context, homePage, scene, editor, toolbar }) => {
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
        await scene.waitForExecutionDone()
        await editor.closePane()
        await toolbar.openFeatureTreePane()
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
        expectedActiveLine: "plane001 = offsetPlane('XY', 10)",
      })
      await testViewSource({
        operationName: 'Extrude',
        operationIndex: 1,
        expectedActiveLine: 'extrude001 = extrude(10, sketch002)',
      })
      await testViewSource({
        operationName: 'Revolve',
        operationIndex: 0,
        expectedActiveLine: 'revolve001 = revolve({ axis = "X" }, sketch001)',
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
    `User can edit a sketch (on default plane) from the feature tree`,
    { tag: '@electron' },
    async ({ context, homePage, scene, editor, toolbar }) => {
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
        await scene.waitForExecutionDone()
        await toolbar.openFeatureTreePane()
      })

      await test.step('Double click on the sketch operation', async () => {
        await (await toolbar.getFeatureTreeOperation('Sketch', 0))
          .first()
          .dblclick()
        await expect(
          toolbar.exitSketchBtn,
          'We should be in sketch mode now'
        ).toBeVisible()
        await editor.expectState({
          highlightedCode: '',
          diagnostics: [],
          activeLines: ["sketch001 = startSketchOn('XZ')"],
        })
      })
    }
  )
  test.fixme(
    'User can edit a sketch (on an offset plane) from the feature tree',
    async () => {}
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
    const initialCode = `sketch001 = startSketchOn('XZ')
      |> circle({ center = [0, 0], radius = 5 }, %)
      renamedExtrude = extrude(${initialInput}, sketch001)`
    const newConstantName = 'distance001'
    const expectedCode = `${newConstantName} = 23
      sketch001 = startSketchOn('XZ')
      |> circle({ center = [0, 0], radius = 5 }, %)
      renamedExtrude = extrude(${newConstantName}, sketch001)`

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
      await scene.waitForExecutionDone()
      await toolbar.openFeatureTreePane()
    })

    await test.step('Double click on the extrude operation', async () => {
      await (await toolbar.getFeatureTreeOperation('Extrude', 0))
        .first()
        .dblclick()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [`renamedExtrude = extrude(${initialInput}, sketch001)`],
      })
      await cmdBar.expectState({
        commandName: 'Extrude',
        stage: 'arguments',
        currentArgKey: 'distance',
        currentArgValue: initialInput,
        headerArguments: {
          Selection: '1 face',
          Distance: initialInput,
        },
        highlightedHeaderArg: 'distance',
      })
    })

    await test.step('Add a named constant for distance argument and submit', async () => {
      await expect(cmdBar.currentArgumentInput).toBeVisible()
      const addVariableButton = page.getByRole('button', {
        name: 'Create new variable',
      })
      await addVariableButton.click()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '1 face',
          // The calculated value is shown in the argument summary
          Distance: initialInput,
        },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [
          `renamedExtrude = extrude(${newConstantName}, sketch002)`,
        ],
      })
      await editor.expectEditor.toContain(expectedCode)
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
    const testCode = (value: string) => `p = offsetPlane('XY', ${value})`
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
      await scene.waitForExecutionDone()
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
})
