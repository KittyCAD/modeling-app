import { expect, test } from '@e2e/playwright/zoo-test'
import { LEGACY_SKETCH_MODE_REMOVED_MESSAGE } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Legacy sketch mode', { tag: '@web' }, () => {
  test('Editing disabled', async ({
    homePage,
    page,
    scene,
    editor,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled()

    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        '',
        `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
`
      )
    )
    await editor.expectEditor.toContain('startProfile')

    await test.step('Clicking startProfile shows Edit Sketch disabled', async () => {
      await page.getByText('startProfile').first().click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeDisabled()
    })

    await test.step('Double-clicking the sketch in the feature tree shows a toast', async () => {
      const sketchOperation = await toolbar.getFeatureTreeOperation('Sketch', 0)
      await sketchOperation.dblclick()
      await expect(
        page.getByText(LEGACY_SKETCH_MODE_REMOVED_MESSAGE)
      ).toBeVisible()
    })
  })

  test.describe('Downstream consumers', () => {
    test('Fillet point-and-click delete', async ({
      page,
      homePage,
      scene,
      editor,
      toolbar,
    }) => {
      const initialCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12)
  |> fillet(radius = 5, tags = [seg01]) // fillet01
  |> fillet(radius = 5, tags = [seg02]) // fillet02
fillet03 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])
fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg02)])
`
      const standaloneFilletCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12, tagEnd = $capEnd001)
fillet03 = fillet(extrude001, radius = 5, edges = [{ sideFaces = [seg01, capEnd001] }])
fillet(extrude001, radius = 5, edges = [{ sideFaces = [seg02, capEnd001] }])
`
      const firstPipedFilletDeclaration = 'fillet(radius = 5, tags = [seg01])'
      const secondPipedFilletDeclaration = 'fillet(radius = 5, tags = [seg02])'
      const standaloneAssignedFilletDeclaration =
        'fillet03 = fillet(extrude001, radius = 5, edges = [{ sideFaces = [seg01, capEnd001] }])'
      const standaloneUnassignedFilletDeclaration =
        'fillet(extrude001, radius = 5, edges = [{ sideFaces = [seg02, capEnd001] }])'
      const legacyStandaloneAssignedFilletDeclaration =
        'fillet03 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])'
      const legacyStandaloneUnassignedFilletDeclaration =
        'fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg02)])'

      const deleteFeatureTreeOperation = async (
        operationName: string,
        operationIndex: number
      ) => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          operationName,
          operationIndex
        )
        await scene.waitForExecutionDoneAfter(async () => {
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
        })
      }

      await test.step('Initial test setup', async () => {
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.goToModelingScene()
        await scene.settled()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', initialCode)
        )
      })

      await test.step('Delete fillet via feature tree selection', async () => {
        await test.step('Open Feature Tree Pane', async () => {
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        })

        await test.step('Delete piped fillet via feature tree selection', async () => {
          await test.step('Verify all fillets are present in the editor', async () => {
            await editor.expectEditor.toContain(firstPipedFilletDeclaration)
            await editor.expectEditor.toContain(secondPipedFilletDeclaration)
            await editor.expectEditor.toContain(
              legacyStandaloneAssignedFilletDeclaration
            )
            await editor.expectEditor.toContain(
              legacyStandaloneUnassignedFilletDeclaration
            )
          })
          await test.step('Delete piped fillet', async () => {
            await deleteFeatureTreeOperation('Fillet', 0)
          })
          await test.step('Verify piped fillet is deleted but other fillets are not (in the editor)', async () => {
            await editor.expectEditor.not.toContain(firstPipedFilletDeclaration)
            await editor.expectEditor.not.toContain(
              secondPipedFilletDeclaration
            )
            await editor.expectEditor.toContain(
              legacyStandaloneAssignedFilletDeclaration
            )
            await editor.expectEditor.toContain(
              legacyStandaloneUnassignedFilletDeclaration
            )
          })
        })

        await test.step('Load standalone fillets using new edge syntax', async () => {
          await editor.openPane()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', standaloneFilletCode)
          )
          await editor.expectEditor.toContain(
            standaloneAssignedFilletDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedFilletDeclaration,
            { shouldNormalise: true }
          )
        })

        await test.step('Delete standalone assigned fillet via feature tree selection', async () => {
          await test.step('Delete standalone assigned fillet', async () => {
            await deleteFeatureTreeOperation('fillet03', 0)
          })
          await test.step('Verify standalone assigned fillet is deleted but other two fillets are not (in the editor)', async () => {
            await editor.expectEditor.not.toContain(
              secondPipedFilletDeclaration
            )
            await editor.expectEditor.not.toContain(
              standaloneAssignedFilletDeclaration
            )
            await editor.expectEditor.toContain(
              standaloneUnassignedFilletDeclaration,
              { shouldNormalise: true }
            )
          })
        })

        await test.step('Delete standalone unassigned fillet via feature tree selection', async () => {
          await test.step('Delete standalone unassigned fillet', async () => {
            await deleteFeatureTreeOperation('Fillet', 0)
          })
          await test.step('Verify standalone unassigned fillet is deleted but other fillet is not (in the editor)', async () => {
            await editor.expectEditor.not.toContain(
              secondPipedFilletDeclaration
            )
            await editor.expectEditor.not.toContain(
              standaloneUnassignedFilletDeclaration,
              { shouldNormalise: true }
            )
          })
        })
      })
    })
  })
})
