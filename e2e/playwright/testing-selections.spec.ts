import { resetView } from '@e2e/playwright/lib/sceneSupport'
import { sansWhitespace } from '@e2e/playwright/lib/textAssertions'
import { expect, test } from '@e2e/playwright/zoo-test'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import fs from 'fs'
import path from 'path'

const bracket = fs.readFileSync(
  path.resolve('public', 'kcl-samples', 'bracket', 'main.kcl'),
  'utf8'
)

test.use({ useTestSettings: true })

test.describe('Testing selections', { tag: '@web' }, () => {
  for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
    test(`Testing selections (and hovers) work on sketches when NOT in sketch mode ${rendererTag}`, async ({
      page,
      homePage,
      scene,
      cmdBar,
      folderSetupFn,
      fs,
    }) => {
      const cases = [
        {
          pos: [0.31, 0.5],
          edgeIndex: 0,
          expectedCode: 'line(end = [74.36, 130.4], tag = $seg01)',
        },
        {
          pos: [0.448, 0.557],
          edgeIndex: 2,
          expectedCode: 'angledLine(angle = segAng(seg01), length = yo)',
        },
        {
          pos: [0.753, 0.5],
          edgeIndex: 4,
          expectedCode: 'tangentialArc(endAbsolute = [167.95, -28.85])',
        },
      ] as const
      await folderSetupFn(async (dir) => {
        const projectDir = path.join(dir, 'demo-project')
        await fs.mkdir(projectDir, { recursive: true })
        await fs.writeFile(
          path.join(projectDir, 'main.kcl'),
          new TextEncoder().encode(
            `@settings(defaultLengthUnit = in)
yo = 79
part001 = startSketchOn(XZ)
  |> startProfile(at = [-40.54, -26.74])
  |> ${cases[0].expectedCode}
  |> line(end = [-3.19, -138.43])
  |> ${cases[1].expectedCode}
  |> line(end = [41.19, 28.97 + 5])
  |> ${cases[2].expectedCode}`
          )
        )
      })
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.openProject('demo-project')
      await scene.settled()

      // end setup, now test hover and selects
      for (const { pos, edgeIndex, expectedCode } of cases) {
        const [click, hover] = await scene.makeSelectionHelpers({
          kind: 'edge',
          index: edgeIndex,
          stream: { x: pos[0], y: pos[1], format: 'ratio', steps: 5 },
        })
        // hover over segment, check it's content
        await hover()
        await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
        await expect(page.getByTestId('hover-highlight').first()).toHaveText(
          expectedCode
        )
        // hover over segment, click it and check the cursor has move to the right place
        await click()
        await expect(page.locator('.cm-activeLine')).toContainText(expectedCode)
      }
    })
  }

  for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
    test(`"View KCL source code" right click menu in scene ${rendererTag}`, async ({
      editor,
      page,
      homePage,
      scene,
    }) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      const [clickEmptyScene] = scene.makeMouseHelpers(0.5, 0.9, {
        format: 'ratio',
      })

      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode('', bracket)
      )
      await resetView(scene)
      await editor.scrollToText(bracket.trimStart().split('\n')[0])

      const laterCode = page.getByText('finalBracket = hole::holes(')
      await expect(laterCode).not.toBeInViewport()
      await editor.closePane()

      const menuItems = page.locator(
        '[data-testid="view-controls-menu"] button'
      )
      const viewKclSourceCodeOption = menuItems.filter({
        hasText: 'View KCL source code',
      })

      await test.step('Empty scene has disabled "View KCL source code"', async () => {
        await clickEmptyScene({ shouldRightClick: true })
        await expect(page.getByTestId('view-controls-menu')).toBeVisible()
        await expect(viewKclSourceCodeOption).toBeVisible()
        await expect(viewKclSourceCodeOption).toBeDisabled()
        await page.keyboard.press('Escape')
      })

      await test.step('Right click on bracket navigates to its source', async () => {
        await expect(laterCode).not.toBeInViewport()
        const [clickBracket] = (await page.evaluate(
          () => window.engineCommandManager.geometryOnly
        ))
          ? await scene.findEntity('bodyFace', 0)
          : scene.makeMouseHelpers(0.45, 0.45, { format: 'ratio' })
        await clickBracket()
        await expect(page.getByText('1 face')).toBeVisible()
        await clickBracket({ shouldRightClick: true })
        await expect(viewKclSourceCodeOption).toBeVisible()
        await expect(viewKclSourceCodeOption).toBeEnabled()
        await expect(editor.codeContent).not.toBeVisible()
        await viewKclSourceCodeOption.click()
        await expect(editor.codeContent).toBeVisible()
        await expect(page.locator('.cm-activeLine')).toBeVisible()
        await expect(page.locator('.cm-activeLine')).not.toContainText(
          'Shelf Bracket'
        )
      })
    })
  }

  const innerShellCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 5)
  |> line(endAbsolute = [0, 5])
  |> line(endAbsolute = [-5, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5, tagEnd = $endCap001)
sketch002 = startSketchOn(extrude001, face = endCap001)
shell001 = shell(extrude001, faces = endCap001, thickness = 0.2)`

  for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
    test(`Engine primitive selection works on shell inner face ${rendererTag}`, async ({
      editor,
      page,
      homePage,
      scene,
      toolbar,
      cmdBar,
    }) => {
      await page.setBodyDimensions({ width: 1200, height: 800 })
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode('', innerShellCode)
      )
      await resetView(scene)

      // Two dumb hardcoded screen ratio values

      const [clearSelection] = scene.makeMouseHelpers(0.8, 0.8, {
        format: 'ratio',
      })

      await test.step(`Click a primitive face and expect the selection to be set to it`, async () => {
        let innerFaceId: string | undefined
        if (rendererTag === '@localRenderer') {
          const faces = await scene.getProjectedEntities()
          innerFaceId = await page.evaluate((faces) => {
            const { artifactGraph } = window.app.singletons.kclManager
            return faces.find(
              (face) =>
                face.visible &&
                face.kind === 'bodyFace' &&
                !artifactGraph.has(face.id)
            )?.id
          }, faces)
          if (!innerFaceId) throw new Error('No visible primitive shell face')
        }
        const [clickOnFace] = await scene.makeSelectionHelpers({
          kind: 'face',
          id: innerFaceId,
          stream: { x: 0.6, y: 0.6, format: 'ratio' },
        })
        await clickOnFace()
        await expect(toolbar.selectionStatus).toContainText('1 face')
      })

      await test.step(`Clicking in the corner resets the selection`, async () => {
        await clearSelection()
        await expect(toolbar.selectionStatus).not.toContainText('1 face')
      })
    })
  }

  for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
    test(`Can start a sketch on a shell inner face ${rendererTag}`, async ({
      page,
      homePage,
      scene,
      toolbar,
      editor,
    }) => {
      const code = `@settings(kclVersion = 2.0)

rectangleSketch = sketch(on = XY) {
  line1 = line(start = [var 0.42mm, var 0.91mm], end = [var 3.1mm, var 0.91mm])
  line2 = line(start = [var 3.1mm, var 0.91mm], end = [var 3.1mm, var 4.36mm])
  line3 = line(start = [var 3.1mm, var 4.36mm], end = [var 0.42mm, var 4.36mm])
  line4 = line(start = [var 0.42mm, var 4.36mm], end = [var 0.42mm, var 0.91mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
extrude001 = extrude(region(point = [1mm, 1mm], sketch = rectangleSketch), length = 1, tagEnd = $capEnd001)
shell001 = shell(extrude001, faces = capEnd001, thickness = .1)`

      await page.setBodyDimensions({ width: 1200, height: 800 })
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
      await resetView(scene)

      await expect
        .poll(() =>
          page.evaluate(() => window.app.singletons.kclManager.read())
        )
        .toBe(code)

      let innerFaceId: string | undefined
      if (await page.evaluate(() => window.engineCommandManager.geometryOnly)) {
        await scene.moveCameraTo(
          { x: 7, y: -5, z: 8 },
          { x: 1.76, y: 2.635, z: 0.5 }
        )
        const response = await page.evaluate(async () => {
          const shell = window.app.singletons.kclManager.variables.shell001
          if (shell?.type !== 'Solid')
            throw new Error('Expected shell001 to be a solid')
          return window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: {
              type: 'solid3d_get_face_uuid',
              object_id: shell.value.id,
              face_index: 7,
            },
          })
        })
        const result =
          isModelingResponse(response) && response.resp.data.modeling_response
        if (!result || result.type !== 'solid3d_get_face_uuid') {
          throw new Error('Could not resolve faceId(shell001, index = 7)')
        }
        innerFaceId = result.data.face_id
      }
      const [clickOnInnerFace] = await scene.makeSelectionHelpers({
        kind: 'face',
        id: innerFaceId,
        stream: { x: 0.6, y: 0.4, format: 'ratio' },
      })

      await clickOnInnerFace()
      await expect(toolbar.selectionStatus).toHaveText(
        '1 faceCurrently selected geometry'
      )
      await toolbar.startSketchPlaneSelection()

      await expect(toolbar.lineBtn).toBeEnabled()
      await expect
        .poll(async () => sansWhitespace(await editor.getCurrentCode()))
        .toBe(
          sansWhitespace(`@settings(kclVersion = 2.0)


rectangleSketch = sketch(on = XY) {
  line1 = line(start = [var 0.42mm, var 0.91mm], end = [var 3.1mm, var 0.91mm])
  line2 = line(start = [var 3.1mm, var 0.91mm], end = [var 3.1mm, var 4.36mm])
  line3 = line(start = [var 3.1mm, var 4.36mm], end = [var 0.42mm, var 4.36mm])
  line4 = line(start = [var 0.42mm, var 4.36mm], end = [var 0.42mm, var 0.91mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
extrude001 = extrude(region(point = [1mm, 1mm], sketch = rectangleSketch), length = 1, tagEnd = $capEnd001)
shell001 = shell(extrude001, faces = capEnd001, thickness = .1)
face001 = faceOf(shell001, face = faceId(shell001, index = 7))
sketch001 = sketch(on = face001) {
}

`)
        )
    })
  }

  for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
    test(`Shell inner edge: selection uses engine topology_fallback (primitive index); fillet codegen uses edgeId(solid, index) when the artifact graph lacks wall/cap. ${rendererTag}`, async ({
      page,
      homePage,
      scene,
      toolbar,
      modelingDialog,
      editor,
    }) => {
      await page.setBodyDimensions({ width: 1200, height: 800 })
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode('', innerShellCode)
      )
      await resetView(scene)

      if (rendererTag === '@localRenderer') {
        // Expose the original inner edge, whose midpoint is otherwise occluded.
        await scene.moveCameraTo(
          { x: 6.2, y: -18.83, z: 7.77 },
          { x: 0, y: -2.5, z: 2.5 }
        )
      }
      // Original stream selection resolves to shell topology edge 15.
      const [clickOnEdge] = await scene.makeSelectionHelpers({
        kind: 'edge',
        index: 10,
        stream: { x: 0.5, y: 0.6, format: 'ratio' },
      })

      await test.step(`Click a primitive edge and expect the selection to be set to it`, async () => {
        await clickOnEdge()
        await expect(toolbar.selectionStatus).toContainText('1 edge')
      })

      await test.step(`Fillet the selected edge (1mm radius)`, async () => {
        await scene.moveCameraTo(
          { x: 11.58, y: -20.49, z: 5.72 },
          { x: 0, y: -2.6, z: 2.5 }
        )
        // Original stream fillet selection resolves to shell topology edge 19.
        const [clickEdgeForFillet] = await scene.makeSelectionHelpers({
          kind: 'edge',
          index: 12,
          stream: { x: 0.4457, y: 0.5014, format: 'ratio' },
        })
        await clickEdgeForFillet()

        await page.waitForTimeout(100)
        await toolbar.filletButton.click()

        await expect(modelingDialog.selection('Selection')).toHaveText('1 edge')
        await modelingDialog.input('radius').fill('1')

        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('fillet')
        await editor.expectEditor.toContain('radius')
        await editor.expectEditor.toContain('edgeId')
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      })
    })
  }
})
