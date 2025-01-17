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
    |> line(end = [-10, -5])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close(%)
}

length001 = timesFive(1) * 5
sketch001 = startSketchOn('XZ')
  |> startProfileAt([20, 10], %)
  |> line(end = [10, 10])
  |> angledLine([-45, length001], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close(%)
revolve001 = revolve({ axis = "X" }, sketch001)
triangle()
  |> extrude(length = 30)
plane001 = offsetPlane('XY', 10)
sketch002 = startSketchOn(plane001)
  |> startProfileAt([-20, 0], %)
  |> line(end = [5, -15])
  |> xLine(-10, %)
  |> line(endAbsolute = [-40, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close(%)
extrude001 = extrude(sketch002, length = 10)
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
        expectedActiveLine: 'extrude001 = extrude(sketch002, length = 10)',
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
})
