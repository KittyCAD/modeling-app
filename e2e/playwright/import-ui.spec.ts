import { expect, test } from '@e2e/playwright/zoo-test'
import * as fsp from 'fs/promises'
import path from 'path'

test.describe('Import UI tests', () => {
  test('shows toast when trying to sketch on imported face, and hovering over imported geometry should NOT highlight any code', async ({
    context,
    page,
    homePage,
    toolbar,
    scene,
    editor,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const projectDir = path.join(dir, 'import-test')
      await fsp.mkdir(projectDir, { recursive: true })

      // Create the imported file
      await fsp.writeFile(
        path.join(projectDir, 'toBeImported.kcl'),
        `sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([281.54, 305.81], sketch001)
  |> angledLine([0, 123.43], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       85.99
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
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
profile001 = startProfileAt([-134.53, -56.17], sketch001)
  |> angledLine([0, 79.05], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       76.28
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(profile001, length = 100)
sketch003 = startSketchOn(extrude001, seg02)
sketch002 = startSketchOn(extrude001, seg01)`
      )
    })

    await homePage.openProject('import-test')
    await scene.waitForExecutionDone()

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
    const [_, hoverOverNonImport] = scene.makeMouseHelpers(611, 364)
    const [importedFaceClick, hoverOverImported] = scene.makeMouseHelpers(
      940,
      150
    )

    await test.step('check code highlight works for code define in the file being edited', async () => {
      await hoverOverNonImport()
      await editor.expectState({
        highlightedCode: 'startProfileAt([-134.53,-56.17],sketch001)',
        diagnostics: [],
        activeLines: ['import"toBeImported.kcl"asimportedCube'],
      })
    })

    await test.step('check code does nothing when geometry is defined in an import', async () => {
      await hoverOverImported()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: ['import"toBeImported.kcl"asimportedCube'],
      })
    })

    await test.step('check the user is warned when sketching on a imported face', async () => {
      // Start sketch mode
      await toolbar.startSketchPlaneSelection()

      // Click on a face from the imported model
      await importedFaceClick()

      // Verify toast appears with correct content
      await expect(page.getByText('This face is from an import')).toBeVisible()
      await expect(
        page.locator('.font-mono').getByText('toBeImported.kcl')
      ).toBeVisible()
      await expect(
        page.getByText('Please select this from the files pane to edit')
      ).toBeVisible()
    })
  })
})
