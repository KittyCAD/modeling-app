import path from 'path'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import * as fsp from 'fs/promises'

test.describe(
  'Import UI tests',
  { tag: ['@desktop', '@macos', '@windows'] },
  () => {
    for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
      test(`shows toast when trying to sketch on imported face, and hovering over imported geometry should NOT highlight any code ${rendererTag}`, async ({
        page,
        homePage,
        toolbar,
        scene,
        editor,
        cmdBar,
        folderSetupFn,
      }) => {
        await folderSetupFn(async (dir) => {
          const projectDir = path.join(dir, 'import-test')
          await fsp.mkdir(projectDir, { recursive: true })

          // Create the imported file
          await fsp.writeFile(
            path.join(projectDir, 'toBeImported.kcl'),
            `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [281.54, 305.81])
  |> angledLine(angle = 0, length = 123.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 85.99)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude(profile001, length = 100)`
          )

          // Create the main file that imports
          await fsp.writeFile(
            path.join(projectDir, 'main.kcl'),
            `import "toBeImported.kcl" as importedCube

importedCube

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-134.53, -56.17])
  |> angledLine(angle = 0, length = 79.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 76.28)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, face = seg02)
sketch002 = startSketchOn(extrude001, face = seg01)`
          )
        })

        await homePage.openProject('import-test')
        await scene.settled()

        await scene.moveCameraTo(
          {
            x: -114,
            y: -897,
            z: 475,
          },
          {
            x: -114,
            y: -51,
            z: 83,
          }
        )
        await test.step('check code highlight works for code define in the file being edited', async () => {
          // The local cap of the body defined in main.kcl.
          const [, hoverOverNonImport] = await scene.makeSelectionHelpers({
            kind: 'face',
            index: 1,
            stream: { x: 611, y: 364, format: 'pixels' },
          })
          await hoverOverNonImport()
          await editor.expectState({
            // Hover can highlight both the profile and the extrude that produced the face
            highlightedCode:
              'startProfile(sketch001,at=[-134.53,-56.17])extrude(profile001,length=100)',
            diagnostics: [],
            activeLines: ['import"toBeImported.kcl"asimportedCube'],
          })
        })

        await test.step('check code does nothing when geometry is defined in an import', async () => {
          const [, hoverOverImported] = await scene.makeSelectionHelpers({
            kind: 'face',
            index: 3,
            stream: { x: 940, y: 150, format: 'pixels' },
          })
          await hoverOverImported()
          await editor.expectState({
            highlightedCode: '',
            diagnostics: [],
            activeLines: ['import"toBeImported.kcl"asimportedCube'],
          })
        })

        await test.step('check the user is warned when sketching on a imported face', async () => {
          // Start sketch mode
          await toolbar.closePane(DefaultLayoutPaneID.Debug)
          await toolbar.closePane(DefaultLayoutPaneID.Code)
          await toolbar.startSketchPlaneSelection()

          // Click on a face from the imported model
          // Resolve again after closing the panes and entering plane selection.
          const [importedFaceClick] = await scene.makeSelectionHelpers({
            kind: 'face',
            index: 2,
            stream: { x: 940, y: 150, format: 'pixels' },
          })
          await importedFaceClick()

          // Verify toast appears with correct content
          await expect(
            page.getByText('This face is from an import')
          ).toBeVisible()
          await expect(
            page.locator('.font-mono').getByText('toBeImported.kcl')
          ).toBeVisible()
          await expect(
            page.getByText('Please select this from the files pane to edit')
          ).toBeVisible()
        })
      })
    }
  }
)
