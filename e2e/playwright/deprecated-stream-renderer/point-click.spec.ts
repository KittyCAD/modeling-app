/**
 * Temporary coverage for users who still use the streamed renderer during rollout.
 * These are the original coordinate-click tests; the primary suites use local rendering.
 * Delete this directory when the renderer feature flag is retired and local rendering
 * is enabled for every user. Keep the original assertions and click coordinates here.
 */
import {
  expect,
  test,
} from '@e2e/playwright/deprecated-stream-renderer/fixtures'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import fs from 'fs'
import path from 'path'
import * as fsp from 'fs/promises'
import type {
  CmdBarFixture,
  CmdBarSerialised,
} from '@e2e/playwright/fixtures/cmdBarFixture'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import type { BrowserContext, Page } from '@playwright/test'
import { isStepFile } from '@src/lib/fileExtensions'

test.describe(
  'Deprecated streamed renderer point-and-click',
  { tag: '@streamRenderer' },
  () => {
    test.describe('point-click.spec.ts', { tag: '@desktop' }, () => {
      test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })
      test(`Shift-click to select and deselect faces`, async ({
        context,
        cmdBar,
        toolbar,
        page,
        homePage,
        scene,
      }) => {
        // Code samples
        const initialCode = `sketch002 = sketch(on = XY) {
  line1 = line(start = [var -12mm, var -6mm], end = [var -12mm, var 6mm])
  line2 = line(start = [var -12mm, var 6mm], end = [var 12mm, var 6mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 12mm, var 6mm], end = [var 12mm, var -6mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 12mm, var -6mm], end = [var -12mm, var -6mm])
  coincident([line3.end, line4.start])
}
hide(sketch002)
region001 = region(segments = [sketch002.line1, sketch002.line2])
sketch001 = extrude(region001, length = -12)`

        // Locators
        const faceLocation = { x: 630, y: 290 }

        // Setup
        await test.step(`Initial test setup`, async () => {
          await context.addInitScript((initialCode) => {
            localStorage.setItem('persistCode', initialCode)
          }, initialCode)
          await page.setBodyDimensions({ width: 1000, height: 500 })
          await homePage.goToModelingScene()
          await toolbar.closePane(DefaultLayoutPaneID.Code)
          await scene.settled()
        })

        // Click helpers
        const [clickOnFace] = scene.makeMouseHelpers(
          faceLocation.x,
          faceLocation.y
        )

        await test.step('Select the face (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnFace()
          await expect(toolbar.selectionStatus).toContainText('1 face')
          await page.keyboard.up('Shift')
        })
        await test.step('Deselect the face (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnFace()
          await expect(toolbar.selectionStatus).not.toContainText('1 face')
          await page.keyboard.up('Shift')
        })
      })

      test(`Fillet point-and-click`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        // Code samples
        const initialCode = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -12mm, var -6mm], end = [var -12mm, var 6mm])
  line2 = line(start = [var -12mm, var 6mm], end = [var 12mm, var 6mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 12mm, var 6mm], end = [var 12mm, var -6mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 12mm, var -6mm], end = [var -12mm, var -6mm])
  coincident([line3.end, line4.start])
}
hide(sketch001)
region001 = region(segments = [sketch001.line1, sketch001.line2])
extrude001 = extrude(region001, length = -12)`
        const firstFilletDeclaration = `fillet001 = fillet(extrude001, edges=[{sideFaces=[region001.tags.line2,extrude001.faces.capEnd001]}], radius=5,)`
        const secondFilletDeclaration = `fillet002 = fillet(extrude001, edges=[{sideFaces=[region001.tags.line2,extrude001.faces.capStart001]}], radius=5,)`

        // Locators
        // TODO: find a way to not have hardcoded pixel values for region edges and sweepEdges
        const firstEdgeLocation = { x: 600, y: 195 }
        const [clickOnFirstEdge] = scene.makeMouseHelpers(
          firstEdgeLocation.x,
          firstEdgeLocation.y
        )
        const secondEdgeLocation = { x: 600, y: 383 }
        const [clickOnSecondEdge] = scene.makeMouseHelpers(
          secondEdgeLocation.x,
          secondEdgeLocation.y
        )

        // Setup
        await test.step(`Initial test setup`, async () => {
          await context.addInitScript((initialCode) => {
            localStorage.setItem('persistCode', initialCode)
          }, initialCode)
          await page.setBodyDimensions({ width: 1000, height: 500 })
          await homePage.goToModelingScene()
          await scene.settled()
        })

        // Test 1: Command bar flow with preselected edges
        await test.step(`Select first edge`, async () => {
          await clickOnFirstEdge()
        })

        await test.step(`Apply fillet to the preselected edge`, async () => {
          await page.waitForTimeout(100)
          await toolbar.filletButton.click()
          await cmdBar.expectState({
            commandName: 'Fillet',
            highlightedHeaderArg: 'selection',
            currentArgKey: 'selection',
            currentArgValue: '',
            headerArguments: {
              Selection: '',
              Radius: '',
            },
            stage: 'arguments',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Fillet',
            highlightedHeaderArg: 'radius',
            currentArgKey: 'radius',
            currentArgValue: '5',
            headerArguments: {
              Selection: '1 edge',
              Radius: '',
            },
            stage: 'arguments',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Fillet',
            headerArguments: {
              Selection: '1 edge',
              Radius: '5',
            },
            stage: 'review',
          })
          await cmdBar.progressCmdBar()
        })

        await test.step(`Confirm code is added to the editor`, async () => {
          await editor.expectEditor.toContain(firstFilletDeclaration, {
            shouldNormalise: true,
          })
        })

        // Test 1.1: Edit fillet (segment type)
        async function editFillet(
          featureTreeIndex: number,
          oldValue: string,
          newValue: string
        ) {
          await scene.settled()
          // await scene.waitForExecutionDoneAfter(async () =>
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
          // )
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Fillet',
            featureTreeIndex
          )
          await operationButton.dblclick({ button: 'left' })
          await cmdBar.expectState({
            commandName: 'Fillet',
            currentArgKey: 'radius',
            currentArgValue: oldValue,
            headerArguments: {
              Radius: oldValue,
            },
            highlightedHeaderArg: 'radius',
            stage: 'arguments',
          })
          await page.keyboard.insertText(newValue)
          await cmdBar.progressCmdBar()
          // await page.pause()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Radius: newValue,
            },
            commandName: 'Fillet',
          })
          await cmdBar.progressCmdBar()
          await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        }

        await test.step('Edit fillet via feature tree selection works', async () => {
          const firstFilletFeatureTreeIndex = 0
          const editedRadius = '1'
          await editFillet(firstFilletFeatureTreeIndex, '5', editedRadius)
          await editor.expectEditor.toContain(
            firstFilletDeclaration.replace(
              'radius=5',
              'radius=' + editedRadius
            ),
            { shouldNormalise: true }
          )

          // Edit back to original radius
          await editFillet(firstFilletFeatureTreeIndex, editedRadius, '5')
          await editor.expectEditor.toContain(firstFilletDeclaration, {
            shouldNormalise: true,
          })
        })

        // Test 2: Command bar flow without preselected edges
        await test.step(`Open fillet UI without selecting edges`, async () => {
          await page.waitForTimeout(100)
          const [clearSelection] = scene.makeMouseHelpers(0.5, 0.5, {
            format: 'ratio',
          })
          await clearSelection()
          await page.waitForTimeout(100)
          await toolbar.filletButton.click()
          await expect
            .poll(() => page.getByText('Please select one').count())
            .toBe(1)
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'selection',
            currentArgValue: '',
            headerArguments: {
              Selection: '',
              Radius: '',
            },
            highlightedHeaderArg: 'selection',
            commandName: 'Fillet',
          })
        })

        await test.step(`Select second edge`, async () => {
          await clickOnSecondEdge()
        })

        await test.step(`Apply fillet to the second edge`, async () => {
          await cmdBar.expectState({
            commandName: 'Fillet',
            highlightedHeaderArg: 'selection',
            currentArgKey: 'selection',
            currentArgValue: '',
            headerArguments: {
              Selection: '',
              Radius: '',
            },
            stage: 'arguments',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Fillet',
            highlightedHeaderArg: 'radius',
            currentArgKey: 'radius',
            currentArgValue: '5',
            headerArguments: {
              Selection: '1 edge',
              Radius: '',
            },
            stage: 'arguments',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Fillet',
            headerArguments: {
              Selection: '1 edge',
              Radius: '5',
            },
            stage: 'review',
          })
          await cmdBar.progressCmdBar()
        })

        await test.step(`Confirm code is added to the editor`, async () => {
          await editor.expectEditor.toContain(secondFilletDeclaration, {
            shouldNormalise: true,
          })
        })

        // Test 2.1: Edit fillet (edgeSweep type)
        await test.step('Edit fillet via feature tree selection works', async () => {
          const secondFilletFeatureTreeIndex = 1
          const editedRadius = '2'
          await editFillet(secondFilletFeatureTreeIndex, '5', editedRadius)
          await editor.expectEditor.toContain(
            secondFilletDeclaration.replace(
              'radius=5',
              'radius=' + editedRadius
            ),
            { shouldNormalise: true }
          )

          // Edit back to original radius
          await editFillet(secondFilletFeatureTreeIndex, editedRadius, '5')
          await editor.expectEditor.toContain(secondFilletDeclaration, {
            shouldNormalise: true,
          })
        })

        // Test 3: Delete fillets
        await test.step('Delete fillet via feature tree selection', async () => {
          await test.step('Open Feature Tree Pane', async () => {
            await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
            await page.waitForTimeout(500)
          })
          await test.step('Delete fillet via feature tree selection', async () => {
            await editor.expectEditor.toContain(secondFilletDeclaration, {
              shouldNormalise: true,
            })
            const operationButton = await toolbar.getFeatureTreeOperation(
              'Fillet',
              1
            )
            await operationButton.click({ button: 'left' })
            await page.keyboard.press('Delete')
            await page.waitForTimeout(500)
            await editor.expectEditor.not.toContain(secondFilletDeclaration)
          })
        })
      })

      test(`Fillet with large radius should update code even if engine fails`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        // Create a cube with small edges that will cause some fillets to fail
        const initialCode = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 0mm, var -1mm])
  line2 = line(start = [var 0mm, var -1mm], end = [var -10mm, var -1mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -10mm, var -1mm], end = [var -10mm, var 9mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -10mm, var 9mm], end = [var 0mm, var 0mm])
  coincident([line3.end, line4.start])
  vertical(line1)
  horizontal(line2)
  vertical(line3)
}
region001 = region(segments = [sketch001.line1, sketch001.line2])
extrude001 = extrude(region001, length = 5)`
        // Locators
        // TODO: find a way to select sweepEdges in a different way
        const edgeLocation = { x: 649, y: 283 }

        // Setup
        await test.step(`Initial test setup`, async () => {
          await context.addInitScript((initialCode) => {
            localStorage.setItem('persistCode', initialCode)
          }, initialCode)
          await page.setBodyDimensions({ width: 1000, height: 500 })
          await homePage.goToModelingScene()
          await scene.settled()
        })

        // Test
        await test.step('Select edges and apply oversized fillet', async () => {
          await test.step(`Select the edge`, async () => {
            await toolbar.closePane(DefaultLayoutPaneID.Code)
            const [clickOnTheEdge] = scene.makeMouseHelpers(
              edgeLocation.x,
              edgeLocation.y
            )
            await clickOnTheEdge()
          })

          await test.step(`Apply fillet`, async () => {
            await page.waitForTimeout(100)
            await toolbar.filletButton.click()
            await cmdBar.expectState({
              commandName: 'Fillet',
              highlightedHeaderArg: 'selection',
              currentArgKey: 'selection',
              currentArgValue: '',
              headerArguments: {
                Selection: '',
                Radius: '',
              },
              stage: 'arguments',
            })
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              commandName: 'Fillet',
              highlightedHeaderArg: 'radius',
              currentArgKey: 'radius',
              currentArgValue: '5',
              headerArguments: {
                Selection: '1 edge',
                Radius: '',
              },
              stage: 'arguments',
            })
            // Set a large radius (1000)
            await cmdBar.currentArgumentInput
              .locator('.cm-content')
              .fill('1000')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              commandName: 'Fillet',
              headerArguments: {
                Selection: '1 edge',
                Radius: '1000',
              },
              stage: 'review',
            })
            // Apply fillet with large radius
            await cmdBar.progressCmdBar()
          })
        })

        await test.step('Verify code is updated regardless of execution errors', async () => {
          const code = await editor.getCurrentCode()
          const normalizedCode = code.replace(/\s+/g, '')

          expect(normalizedCode).toContain('fillet001=fillet(extrude001,')
          expect(normalizedCode).toContain(
            'edges=[{sideFaces=[region001.tags.line1,region001.tags.line3]}]'
          )
          expect(normalizedCode).toContain('radius=1000,')
          expect(normalizedCode).not.toContain('tags=[')
        })
      })

      test(`Chamfer point-and-click`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        // Code samples
        const initialCode = `@settings(defaultLengthUnit = in)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -12in, var -6in], end = [var -12in, var 6in])
  line2 = line(start = [var -12in, var 6in], end = [var 12in, var 6in])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 12in, var 6in], end = [var 12in, var -6in])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 12in, var -6in], end = [var -12in, var -6in])
  coincident([line3.end, line4.start])
}
hide(sketch001)
region001 = region(segments = [sketch001.line1, sketch001.line2])
extrude001 = extrude(region001, length = -12)`
        const firstChamferDeclaration = `chamfer001 = chamfer(extrude001, edges=[{sideFaces=[region001.tags.line2,extrude001.faces.capEnd001]}], length=5,)`
        const secondChamferDeclaration = `chamfer002 = chamfer(extrude001, edges=[{sideFaces=[region001.tags.line2,extrude001.faces.capStart001]}], length=5,)`

        // Locators
        const firstEdgeLocation = { x: 600, y: 193 }
        const secondEdgeLocation = { x: 600, y: 383 }

        // Setup
        await test.step(`Initial test setup`, async () => {
          await context.addInitScript((initialCode) => {
            localStorage.setItem('persistCode', initialCode)
          }, initialCode)
          await page.setBodyDimensions({ width: 1000, height: 500 })
          await homePage.goToModelingScene()
          await scene.settled()
          await editor.closePane()
        })

        const [clickOnFirstEdge] = scene.makeMouseHelpers(
          firstEdgeLocation.x,
          firstEdgeLocation.y
        )
        const [clickOnSecondEdge] = scene.makeMouseHelpers(
          secondEdgeLocation.x,
          secondEdgeLocation.y
        )

        // Test 1: Command bar flow with preselected edges
        await test.step(`Select first edge`, async () => {
          await clickOnFirstEdge()
          await editor.openPane()
        })

        await test.step(`Apply chamfer to the preselected edge`, async () => {
          await page.waitForTimeout(100)
          await toolbar.chamferButton.click()
          await cmdBar.expectState({
            commandName: 'Chamfer',
            highlightedHeaderArg: 'selection',
            currentArgKey: 'selection',
            currentArgValue: '',
            headerArguments: {
              Selection: '',
              Length: '',
            },
            stage: 'arguments',
          })
          await cmdBar.progressCmdBar()
          await page.waitForTimeout(1000)
          await cmdBar.expectState({
            commandName: 'Chamfer',
            highlightedHeaderArg: 'length',
            currentArgKey: 'length',
            currentArgValue: '5',
            headerArguments: {
              Selection: '1 edge',
              Length: '',
            },
            stage: 'arguments',
          })
          await cmdBar.argumentInput.focus()
          await page.waitForTimeout(1000)
          await cmdBar.progressCmdBar()
          await page.waitForTimeout(1000)
          await cmdBar.expectState({
            commandName: 'Chamfer',
            headerArguments: {
              Selection: '1 edge',
              Length: '5',
            },
            stage: 'review',
          })
          await cmdBar.progressCmdBar()
        })

        await test.step(`Confirm code is added to the editor`, async () => {
          await editor.expectEditor.toContain(firstChamferDeclaration, {
            shouldNormalise: true,
          })
          await editor.closePane()
        })

        // Test 1.1: Edit sweep
        async function editChamfer(
          operationName: string,
          oldValue: string,
          newValue: string
        ) {
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
          await page.waitForTimeout(300)
          const operationButton = await toolbar.getFeatureTreeOperation(
            operationName,
            0
          )
          await operationButton.dblclick({ button: 'left' })
          await cmdBar.expectState({
            commandName: 'Chamfer',
            currentArgKey: 'length',
            currentArgValue: oldValue,
            headerArguments: {
              Length: oldValue,
            },
            highlightedHeaderArg: 'length',
            stage: 'arguments',
          })
          await page.keyboard.insertText(newValue)
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Length: newValue,
            },
            commandName: 'Chamfer',
          })
          await cmdBar.progressCmdBar()
          await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        }

        await test.step('Edit chamfer via feature tree selection works', async () => {
          const editedLength = '1'
          await editChamfer('chamfer001', '5', editedLength)
          await editor.expectEditor.toContain(
            firstChamferDeclaration.replace(
              'length=5',
              'length=' + editedLength
            ),
            { shouldNormalise: true }
          )

          // Edit back to original length
          await editChamfer('chamfer001', editedLength, '5')
          await editor.expectEditor.toContain(firstChamferDeclaration, {
            shouldNormalise: true,
          })
        })

        // Test 2: Command bar flow without preselected edges
        await test.step(`Open chamfer UI without selecting edges`, async () => {
          // The preceding edit leaves its edge selected; clear it so this exercises
          // opening Chamfer without a preselection.
          const [clearSelection] = scene.makeMouseHelpers(0.5, 0.5, {
            format: 'ratio',
          })
          await clearSelection()
          await expect(toolbar.selectionStatus).not.toContainText('edge')
          await page.waitForTimeout(100)
          await toolbar.chamferButton.click()
          await expect
            .poll(() => page.getByText('Please select one').count())
            .toBe(1)
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'selection',
            currentArgValue: '',
            headerArguments: {
              Selection: '',
              Length: '',
            },
            highlightedHeaderArg: 'selection',
            commandName: 'Chamfer',
          })
        })

        await test.step(`Select second edge`, async () => {
          await clickOnSecondEdge()
        })

        await test.step(`Apply chamfer to the second edge`, async () => {
          await cmdBar.expectState({
            commandName: 'Chamfer',
            highlightedHeaderArg: 'selection',
            currentArgKey: 'selection',
            currentArgValue: '',
            headerArguments: {
              Selection: '',
              Length: '',
            },
            stage: 'arguments',
          })
          await editor.openPane()
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Chamfer',
            highlightedHeaderArg: 'length',
            currentArgKey: 'length',
            currentArgValue: '5',
            headerArguments: {
              Selection: '1 edge',
              Length: '',
            },
            stage: 'arguments',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Chamfer',
            headerArguments: {
              Selection: '1 edge',
              Length: '5',
            },
            stage: 'review',
          })
          await cmdBar.progressCmdBar()
        })

        await test.step(`Confirm code is added to the editor`, async () => {
          await editor.expectEditor.toContain(secondChamferDeclaration, {
            shouldNormalise: true,
          })
          await editor.closePane()
        })

        // Test 2.1: Edit chamfer (edgeSweep type)
        await test.step('Edit chamfer via feature tree selection works', async () => {
          const editedLength = '2'
          await editChamfer('chamfer002', '5', editedLength)
          await editor.expectEditor.toContain(
            secondChamferDeclaration.replace(
              'length=5',
              'length=' + editedLength
            ),
            { shouldNormalise: true }
          )

          // Edit back to original length
          await editChamfer('chamfer002', editedLength, '5')
          await editor.expectEditor.toContain(secondChamferDeclaration, {
            shouldNormalise: true,
          })
          await editor.closePane()
        })

        // Test 3: Delete chamfer via feature tree selection
        await test.step('Open Feature Tree Pane', async () => {
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
          await page.waitForTimeout(500)
        })
        await test.step('Delete chamfer via feature tree selection', async () => {
          const operationButton = await toolbar.getFeatureTreeOperation(
            'chamfer002',
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled()
          await editor.expectEditor.not.toContain(secondChamferDeclaration, {
            shouldNormalise: true,
          })
        })
      })

      test(`Shell point-and-click`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        const initialCode = `@settings(defaultLengthUnit = in)

sketch001 = sketch(on = XZ) {
  circle1 = circle(start = [var 30in, var 0in], center = [var 0in, var 0in])
}
region001 = region(segments = [sketch001.circle1])
extrude001 = extrude(region001, length = 30)`
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
        const shellDeclaration2 =
          'shell001 = shell(extrude001, faces = capStart001, thickness = 5)'
        const secondaryShellFaceDeclaration =
          'extrude001 = extrude(profile001, length = 500, tagStart = $capStart001)'
        const editedShellDeclaration =
          'shell001 = shell(extrude001, faces = capEnd001, thickness = 2)'
        const secondaryShellCode = `sketch001 = startSketchOn(-XZ)
profile001 = startProfile(sketch001, at = [-219, 25])
  |> angledLine(angle = 0deg, length = 488, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 472)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(profile001, length = 500)`
        const secondaryShellClickPoint = {
          x: 0.4935,
          y: 0.5159,
          format: 'ratio' as const,
        }

        await test.step(`Go through the command bar flow without preselected faces`, async () => {
          await toolbar.shellButton.click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
              Thickness: '',
            },
            highlightedHeaderArg: 'faces',
            commandName: 'Shell',
          })
          await clickOnCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'thickness',
            currentArgValue: '5',
            headerArguments: {
              Faces: '1 face',
              Thickness: '',
            },
            highlightedHeaderArg: 'thickness',
            commandName: 'Shell',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Faces: '1 face',
              Thickness: '5',
            },
            commandName: 'Shell',
          })
          await cmdBar.submit()
        })

        await test.step(`Confirm code is added to the editor`, async () => {
          await scene.settled()
          await editor.expectEditor.toContain(shellDeclaration)
          await editor.expectState({
            diagnostics: [],
            activeLines: [shellDeclaration],
          })
        })

        await test.step('Edit shell via feature tree selection works', async () => {
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Shell',
            0
          )
          await operationButton.dblclick()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'thickness',
            currentArgValue: '5',
            headerArguments: {
              Thickness: '5',
            },
            highlightedHeaderArg: 'thickness',
            commandName: 'Shell',
          })
          await page.keyboard.insertText('2')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Thickness: '2',
            },
            commandName: 'Shell',
          })
          await cmdBar.submit()
          await scene.settled()
          await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
          await toolbar.openPane(DefaultLayoutPaneID.Code)
          await editor.expectEditor.toContain(editedShellDeclaration)
          await editor.expectState({
            diagnostics: [],
            activeLines: [editedShellDeclaration],
          })
        })

        await test.step('Delete shell via feature tree selection', async () => {
          await editor.closePane()
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Shell',
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled()
          await editor.expectEditor.not.toContain(shellDeclaration)
        })
        await test.step('Replace modeling code with secondary shell snippet', async () => {
          await editor.openPane()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', secondaryShellCode)
          )
          await editor.closePane()
        })

        await test.step('Repeat shell flow on secondary code (pause before selecting face)', async () => {
          const [clickOnDebugCap] = scene.makeMouseHelpers(
            secondaryShellClickPoint.x,
            secondaryShellClickPoint.y,
            { format: secondaryShellClickPoint.format ?? undefined }
          )
          await toolbar.shellButton.click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
              Thickness: '',
            },
            highlightedHeaderArg: 'faces',
            commandName: 'Shell',
          })

          await clickOnDebugCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'thickness',
            currentArgValue: '5',
            headerArguments: {
              Faces: '1 face',
              Thickness: '',
            },
            highlightedHeaderArg: 'thickness',
            commandName: 'Shell',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Faces: '1 face',
              Thickness: '5',
            },
            commandName: 'Shell',
          })
          await cmdBar.submit()
          await scene.settled()
        })

        await test.step('Confirm secondary shell code exists without diagnostics', async () => {
          await editor.openPane()
          await editor.expectEditor.toContain(secondaryShellFaceDeclaration)
          await editor.expectEditor.toContain(shellDeclaration2)
          await editor.expectState({
            diagnostics: [],
            activeLines: [shellDeclaration2],
          })
          await editor.closePane()
        })
      })

      test(`Delete Face point-and-click`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        const initialCode = `@settings(defaultLengthUnit = in, experimentalFeatures = allow)

sketch001 = sketch(on = XZ) {
  circle1 = circle(start = [var 30in, var 0in], center = [var 0in, var 0in])
}
region001 = region(segments = [sketch001.circle1])
extrude001 = extrude(region001, length = 30)`
        const deleteDeclaration = `surface001 = deleteFace(extrude001, faces = capEnd001)`
        await context.addInitScript((initialCode) => {
          localStorage.setItem('persistCode', initialCode)
        }, initialCode)
        await homePage.goToModelingScene()
        await scene.settled()

        // One dumb hardcoded screen pixel value
        const testPoint = { x: 575, y: 200 }
        const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)

        await test.step(`Go through the command bar flow`, async () => {
          await toolbar.selectSurface('delete-face')
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
            },
            highlightedHeaderArg: 'faces',
            commandName: 'Delete Face',
          })
          await clickOnCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Faces: '1 face',
            },
            commandName: 'Delete Face',
          })
          await cmdBar.submit()
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

      test(`Delete face on a face-API chamfer using its edge-cut tag`, async ({
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        const initialCode = `@settings(defaultLengthUnit = in, experimentalFeatures = allow, kclVersion = "3.0-preview")

sketch001 = sketch(on = XY) {
  line1 = line(start = [-12in, -6in], end = [-12in, 6in])
  line2 = line(start = [-12in, 6in], end = [12in, 6in])
  line3 = line(start = [12in, 6in], end = [12in, -6in])
  line4 = line(start = [12in, -6in], end = [-12in, -6in])
}
region001 = region(point = [0in, 0in], sketch = sketch001)
extrude001 = extrude(region001, length = -12in, tagEnd = $capEnd001)
chamfer001 = chamfer(
  extrude001,
  edges = [{ sideFaces = [capEnd001, region001.tags.line4] }],
  length = 5in,
)`

        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.goToModelingScene()
        await editor.replaceCode('', initialCode)
        await scene.settled()
        await editor.closePane()
        await scene.moveCameraTo(
          { x: 573.4, y: -539.4, z: 453.32 },
          { x: 51.38, y: -17.36, z: -68.74 }
        )

        const [clickChamferFace] = scene.makeMouseHelpers(0.4948, 0.6468, {
          format: 'ratio',
        })
        await toolbar.selectSurface('delete-face')
        await clickChamferFace()
        await toolbar.expectSelection('1 face')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Faces: '1 face' },
          reviewValidationError: undefined,
          commandName: 'Delete Face',
        })
        await cmdBar.submit()
        await scene.settled()

        await editor.expectEditor.toContain('tag = $chamferFace01')
        await editor.expectEditor.toContain(
          'surface001 = deleteFace(chamfer001, faces = chamferFace01)'
        )
      })

      test(`Delete face on an unmapped multi-selector chamfer face`, async ({
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        const initialCode = `@settings(defaultLengthUnit = mm, experimentalFeatures = allow, kclVersion = "3.0-preview")

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 16])
  top = line(start = [24, 16], end = [0, 16])
  left = line(start = [0, 16], end = [0, 0])
}
region001 = region(point = [12, 8], sketch = sketch001)
extrude001 = extrude(region001, length = 10, tagEnd = $endCap)
chamfer001 = chamfer(
  extrude001,
  edges = [
    { sideFaces = [region001.tags.bottom, endCap] },
    { sideFaces = [region001.tags.left, endCap] }
  ],
  length = 2,
)
hide(sketch001)`

        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.goToModelingScene()
        await editor.replaceCode('', initialCode)
        await scene.settled()
        await editor.closePane()
        await scene.moveCameraTo(
          { x: 5.72, y: -14.38, z: 26.13 },
          { x: 12, y: 8, z: 5 }
        )

        const [clickChamferFace] = scene.makeMouseHelpers(0.5631, 0.5459, {
          format: 'ratio',
        })
        await toolbar.selectSurface('delete-face')
        await clickChamferFace()
        await toolbar.expectSelection('1 face')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Faces: '1 face' },
          reviewValidationError: undefined,
          commandName: 'Delete Face',
        })
        await cmdBar.submit()
        await scene.settled()

        await editor.expectEditor.toContain('tag = $chamferFace01')
        await editor.expectEditor.toContain(
          'surface001 = deleteFace(chamfer001, faces = chamferFace01)'
        )
      })

      test(`Delete face on an unmapped chained fillet face`, async ({
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        const initialCode = `@settings(defaultLengthUnit = mm, experimentalFeatures = allow, kclVersion = "3.0-preview")

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
extrude001 = extrude(region001, length = 12, tagEnd = $endCap)
chamfer001 = chamfer(
  extrude001,
  edges = [{ sideFaces = [region001.tags.bottom, endCap] }],
  length = 2,
)
fillet001 = fillet(
  chamfer001,
  edges = [{ sideFaces = [region001.tags.right, endCap] }],
  radius = 2,
)
hide(sketch001)`

        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.goToModelingScene()
        await editor.replaceCode('', initialCode)
        await scene.settled()
        await editor.closePane()
        await scene.moveCameraTo(
          { x: 39.68, y: -7.24, z: 19.4 },
          { x: 15, y: 10, z: 6 }
        )

        const [clickFilletFace] = scene.makeMouseHelpers(0.6532, 0.4954, {
          format: 'ratio',
        })
        await toolbar.selectSurface('delete-face')
        await clickFilletFace()
        await toolbar.expectSelection('1 face')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Faces: '1 face' },
          reviewValidationError: undefined,
          commandName: 'Delete Face',
        })
        await cmdBar.submit()
        await scene.settled()

        await editor.expectEditor.toContain('tag = $filletFace01')
        await editor.expectEditor.toContain(
          'surface001 = deleteFace(fillet001, faces = filletFace01)'
        )
      })

      test('Hole point-and-click', async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        const initialCode = `sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -5mm, var -5mm], end = [var 5mm, var -5mm])
  line2 = line(start = [var 5mm, var -5mm], end = [var 5mm, var 5mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 5mm, var 5mm], end = [var -5mm, var 5mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var -5mm, var 5mm], end = [var -5mm, var -5mm])
  coincident([line3.end, line4.start])
}
region001 = region(segments = [sketch001.line1, sketch001.line2])
extrude001 = extrude(region001, length = 10)`
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
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'face',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '',
              CutAt: '',
              HoleBody: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'face',
          })
          await clickOnCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'cutAt',
            currentArgValue: '[0, 0]',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '',
              HoleBody: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'cutAt',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeBody',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'holeBody',
          })
          await cmdBar.selectOption({ name: 'Blind' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'blindDepth',
            currentArgValue: '2',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '',
              BlindDiameter: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'blindDepth',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'blindDiameter',
            currentArgValue: '1',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'blindDiameter',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeType',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'holeType',
          })
          await cmdBar.selectOption({ name: 'Simple' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeBottom',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'holeBottom',
          })
          await cmdBar.selectOption({ name: 'Flat' }).click()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
          })
          await cmdBar.submit()
        })

        await test.step('Expect hole call added to the editor', async () => {
          await scene.settled()
          await toolbar.openPane(DefaultLayoutPaneID.Code)
          await editor.expectEditor.toContain(
            `extrude001 = extrude(region001, length = 10, tagEnd = $capEnd001)
hole001 = hole::hole(
  extrude001,
  face = capEnd001,
  cutAt = [0, 0],
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 2, diameter = 1),
  holeType = hole::simple(),
)`,
            { shouldNormalise: true }
          )
        })

        await test.step('Edit the hole from the feature-tree', async () => {
          await toolbar.closePane(DefaultLayoutPaneID.Code)
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
          const holeOperation = await toolbar.getFeatureTreeOperation('Hole', 0)
          await holeOperation.dblclick()
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
            commandName: 'Hole',
          })
          await page.getByRole('button', { name: 'Cut at' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'cutAt',
            currentArgValue: '[0, 0]',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'cutAt',
          })
          // Update cut at from [0, 0] to [2, 2]
          await page.getByTestId('vector2d-x-input').fill('2')
          await page.getByTestId('vector2d-y-input').fill('2')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
          })
          await page.getByRole('button', { name: 'Hole type' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeType',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'holeType',
          })
          await cmdBar.selectOption({ name: 'Countersink' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'countersinkAngle',
            currentArgValue: '90deg',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'countersink',
              CountersinkDiameter: '',
              CountersinkAngle: '',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'countersinkAngle',
          })
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('80deg')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'countersinkDiameter',
            currentArgValue: '2',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'countersink',
              CountersinkDiameter: '',
              CountersinkAngle: '80deg',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'countersinkDiameter',
          })
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('3')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'countersink',
              CountersinkDiameter: '3',
              CountersinkAngle: '80deg',
              HoleBottom: 'flat',
            },
          })
          await cmdBar.submit()
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

    test.describe('point-click-sketch-v1.spec.ts', { tag: '@desktop' }, () => {
      test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })
      test(`Shell point-and-click`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
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

        await test.step(`Go through the command bar flow without preselected faces`, async () => {
          await toolbar.shellButton.click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
              Thickness: '',
            },
            highlightedHeaderArg: 'faces',
            commandName: 'Shell',
          })
          await clickOnCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'thickness',
            currentArgValue: '5',
            headerArguments: {
              Faces: '1 face',
              Thickness: '',
            },
            highlightedHeaderArg: 'thickness',
            commandName: 'Shell',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Faces: '1 face',
              Thickness: '5',
            },
            commandName: 'Shell',
          })
          await cmdBar.submit()
        })

        await test.step(`Confirm code is added to the editor`, async () => {
          await scene.settled()
          await editor.expectEditor.toContain(shellDeclaration)
          await editor.expectState({
            diagnostics: [],
            activeLines: [shellDeclaration],
            highlightedCode: '',
          })
        })

        await test.step('Edit shell via feature tree selection works', async () => {
          await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Shell',
            0
          )
          await operationButton.dblclick()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'thickness',
            currentArgValue: '5',
            headerArguments: {
              Thickness: '5',
            },
            highlightedHeaderArg: 'thickness',
            commandName: 'Shell',
          })
          await page.keyboard.insertText('2')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Thickness: '2',
            },
            commandName: 'Shell',
          })
          await cmdBar.submit()
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
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Shell',
            0
          )
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
        cmdBar,
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

        await test.step(`Go through the command bar flow`, async () => {
          await toolbar.selectSurface('delete-face')
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
            },
            highlightedHeaderArg: 'faces',
            commandName: 'Delete Face',
          })
          await clickOnCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Faces: '1 face',
            },
            commandName: 'Delete Face',
          })
          await cmdBar.submit()
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

      test('Hole point-and-click', async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
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
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'face',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '',
              CutAt: '',
              HoleBody: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'face',
          })
          await clickOnCap()
          await toolbar.expectSelection('1 face')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'cutAt',
            currentArgValue: '[0, 0]',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '',
              HoleBody: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'cutAt',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeBody',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'holeBody',
          })
          await cmdBar.selectOption({ name: 'Blind' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'blindDepth',
            currentArgValue: '2',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '',
              BlindDiameter: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'blindDepth',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'blindDiameter',
            currentArgValue: '1',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'blindDiameter',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeType',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: '',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'holeType',
          })
          await cmdBar.selectOption({ name: 'Simple' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeBottom',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: '',
            },
            highlightedHeaderArg: 'holeBottom',
          })
          await cmdBar.selectOption({ name: 'Flat' }).click()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Hole',
            headerArguments: {
              Face: '1 face',
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
          })
          await cmdBar.submit()
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
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
            commandName: 'Hole',
          })
          await page.getByRole('button', { name: 'Cut at' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'cutAt',
            currentArgValue: '[0, 0]',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[0, 0]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'cutAt',
          })
          // Update cut at from [0, 0] to [2, 2]
          await page.getByTestId('vector2d-x-input').fill('2')
          await page.getByTestId('vector2d-y-input').fill('2')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
          })
          await page.getByRole('button', { name: 'Hole type' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'holeType',
            currentArgValue: '',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'simple',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'holeType',
          })
          await cmdBar.selectOption({ name: 'Countersink' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'countersinkAngle',
            currentArgValue: '90deg',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'countersink',
              CountersinkDiameter: '',
              CountersinkAngle: '',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'countersinkAngle',
          })
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('80deg')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'countersinkDiameter',
            currentArgValue: '2',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'countersink',
              CountersinkDiameter: '',
              CountersinkAngle: '80deg',
              HoleBottom: 'flat',
            },
            highlightedHeaderArg: 'countersinkDiameter',
          })
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('3')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Hole',
            headerArguments: {
              CutAt: '[2, 2]',
              HoleBody: 'blind',
              BlindDepth: '2',
              BlindDiameter: '1',
              HoleType: 'countersink',
              CountersinkDiameter: '3',
              CountersinkAngle: '80deg',
              HoleBottom: 'flat',
            },
          })
          await cmdBar.submit()
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

    test.describe('testing-selections.spec.ts', { tag: '@desktop' }, () => {
      const bracket = fs.readFileSync(
        path.resolve('public', 'kcl-samples', 'bracket', 'main.kcl'),
        'utf8'
      )

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
      test('"View KCL source code" right click menu in scene', async ({
        page,
        homePage,
        scene,
      }) => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        const [clickBracket] = scene.makeMouseHelpers(0.45, 0.45, {
          format: 'ratio',
        })
        const [clickEmptyScene] = scene.makeMouseHelpers(0.5, 0.9, {
          format: 'ratio',
        })
        await page.addInitScript((initialCode) => {
          localStorage.setItem('persistCode', initialCode)
        }, bracket)

        await homePage.goToModelingScene()
        await scene.settled()

        const laterCode = page.getByText('finalBracket = hole::holes(')
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
          await clickBracket()
          await expect(page.getByText('1 face')).toBeVisible()
          await clickBracket({ shouldRightClick: true })
          await expect(viewKclSourceCodeOption).toBeVisible()
          await expect(viewKclSourceCodeOption).toBeEnabled()
          await viewKclSourceCodeOption.click()
          await expect(page.locator('.cm-activeLine')).toBeVisible()
          await expect(page.locator('.cm-activeLine')).not.toContainText(
            'Shelf Bracket'
          )
        })
      })

      test(`Engine primitive selection works on shell inner face`, async ({
        context,
        page,
        homePage,
        scene,
        toolbar,
        cmdBar,
      }) => {
        await context.addInitScript((initialCode) => {
          localStorage.setItem('persistCode', initialCode)
        }, innerShellCode)

        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.goToModelingScene()
        await scene.settled()

        // Two dumb hardcoded screen ratio values
        const [clickOnFace] = scene.makeMouseHelpers(0.6, 0.6, {
          format: 'ratio',
        })
        const [clearSelection] = scene.makeMouseHelpers(0.8, 0.8, {
          format: 'ratio',
        })

        await test.step(`Click a primitive face and expect the selection to be set to it`, async () => {
          await clickOnFace()
          await expect(toolbar.selectionStatus).toContainText('1 face')
        })

        await test.step(`Clicking in the corner resets the selection`, async () => {
          await clearSelection()
          await expect(toolbar.selectionStatus).not.toContainText('1 face')
        })
      })
    })

    test.describe(
      'point-click-assemblies.spec.ts',
      { tag: ['@desktop', '@macos', '@windows'] },
      () => {
        async function insertPartIntoAssembly(
          path: string,
          alias: string,
          toolbar: ToolbarFixture,
          cmdBar: CmdBarFixture,
          page: Page
        ) {
          const insertingStepFile = isStepFile(path)

          await toolbar.insertButton.click()
          await cmdBar.selectOption({ name: path }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'localName',
            currentArgValue: '',
            headerArguments: {
              Path: path,
              LocalName: '',
              ...(insertingStepFile ? { Representation: '' } : {}),
            },
            highlightedHeaderArg: 'localName',
            commandName: 'Import',
          })
          await page.keyboard.insertText(alias)
          await cmdBar.progressCmdBar()

          if (insertingStepFile) {
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'Representation',
              currentArgValue: '',
              headerArguments: {
                Path: path,
                LocalName: alias,
                Representation: '',
              },
              highlightedHeaderArg: 'Representation',
              commandName: 'Import',
            })
            await expect(
              page.getByText(
                'Choose how this STEP file should be represented in your model.'
              )
            ).toBeVisible()
            await expect(
              page.getByText(
                'Faster to import. Best when you only need visual reference geometry.'
              )
            ).toBeVisible()
            await expect(
              page.getByText('B-rep (experimental)', { exact: true })
            ).toBeVisible()
            await expect(
              page.getByText(
                'Under development and currently supports only simple shapes. Imported geometry is not editable; use Mesh for now.'
              )
            ).toBeVisible()
            await cmdBar.progressCmdBar()
          }

          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Path: path,
              LocalName: alias,
              ...(insertingStepFile ? { Representation: 'mesh' } : {}),
            },
            commandName: 'Import',
          })
          await cmdBar.progressCmdBar()
        }

        async function testBracketInsertionThenTransformsThenDeletion(
          context: BrowserContext,
          page: Page,
          homePage: HomePageFixture,
          scene: SceneFixture,
          editor: EditorFixture,
          toolbar: ToolbarFixture,
          cmdBar: CmdBarFixture,
          selectionType: 'scene' | 'feature-tree',
          folderSetupFn: (
            fn: (dir: string) => Promise<void>
          ) => Promise<{ dir: string }>
        ) {
          const selectedObjects =
            selectionType === 'scene' ? '1 path' : '1 other'
          async function selectBracket() {
            if (selectionType === 'scene') {
              // The bracket is only visible in the lower-right of the default view
              const [clickBracketInScene] = scene.makeMouseHelpers(0.75, 0.92, {
                format: 'ratio',
              })
              await clickBracketInScene()
              await expect(toolbar.selectionStatus).toContainText(
                /1 (path|face)/
              )
              return
            } else if (selectionType === 'feature-tree') {
              const op = await toolbar.getFeatureTreeOperation('bracket', 0)
              await op.click()
            } else {
              const _exhaustiveCheck: never = selectionType
              throw new Error('unreachable')
            }
          }
          await test.step('Setup parts and expect empty assembly scene', async () => {
            const projectName = 'assembly'
            await folderSetupFn(async (dir) => {
              const bracketDir = path.join(dir, projectName)
              await fsp.mkdir(bracketDir, { recursive: true })
              await Promise.all([
                fsp.copyFile(
                  path.join('public', 'kcl-samples', 'bracket', 'main.kcl'),
                  path.join(bracketDir, 'bracket.kcl')
                ),
                fsp.writeFile(path.join(bracketDir, 'main.kcl'), ''),
              ])
            })
            await page.setBodyDimensions({ width: 1200, height: 800 })
            await homePage.openProject(projectName)
            await scene.settled()
            await toolbar.closePane(DefaultLayoutPaneID.Code)
          })

          await test.step('Import kcl as module', async () => {
            await insertPartIntoAssembly(
              'bracket.kcl',
              'bracket',
              toolbar,
              cmdBar,
              page
            )
            await toolbar.openPane(DefaultLayoutPaneID.Code)
            await editor.expectEditor.toContain(
              `
            import "bracket.kcl" as bracket
          `,
              { shouldNormalise: true }
            )
            await scene.settled()
          })

          await test.step('Set translate on module', async () => {
            await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
            await toolbar.selectTransform('translate')
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'objects',
              currentArgValue: '',
              headerArguments: {
                Objects: '',
                X: '5',
              },
              highlightedHeaderArg: 'objects',
              commandName: 'Translate',
            })
            await selectBracket()
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'x',
              currentArgValue: '5',
              headerArguments: {
                Objects: selectedObjects,
                X: '5',
              },
              highlightedHeaderArg: 'x',
              commandName: 'Translate',
            })
            await page.keyboard.insertText('1')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Objects: selectedObjects,
                X: '1',
              },
              commandName: 'Translate',
            })
            await cmdBar.submit()
            await scene.settled()
            await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
            await toolbar.openPane(DefaultLayoutPaneID.Code)
            await editor.expectEditor.toContain(`translate(bracket, x = 1)`, {
              shouldNormalise: true,
            })
          })

          await test.step('Edit translate on module', async () => {
            const op = await toolbar.getFeatureTreeOperation('Translate', 0)
            await op.dblclick()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                X: '1',
              },
              commandName: 'Translate',
            })
            await cmdBar.clickOptionalArgument('y')
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'y',
              currentArgValue: '0',
              headerArguments: {
                X: '1',
                Y: '',
              },
              highlightedHeaderArg: 'y',
              commandName: 'Translate',
            })
            await page.keyboard.insertText('2')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                X: '1',
                Y: '2',
              },
              commandName: 'Translate',
            })
            await cmdBar.submit()
            await scene.settled()
            await editor.expectEditor.toContain(
              `translate(bracket, x = 1, y = 2)`,
              {
                shouldNormalise: true,
              }
            )
          })

          await test.step('Set scale on module', async () => {
            await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
            await toolbar.selectTransform('scale')
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'objects',
              currentArgValue: '',
              headerArguments: {
                Objects: '',
                Factor: '2',
              },
              highlightedHeaderArg: 'objects',
              commandName: 'Scale',
            })
            await selectBracket()
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'factor',
              currentArgValue: '2',
              headerArguments: {
                Objects: selectedObjects,
                Factor: '2',
              },
              highlightedHeaderArg: 'factor',
              commandName: 'Scale',
            })
            await page.keyboard.insertText('1.1')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Objects: selectedObjects,
                Factor: '1.1',
              },
              commandName: 'Scale',
            })
            await cmdBar.submit()
            await scene.settled()
            await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
            await toolbar.openPane(DefaultLayoutPaneID.Code)
            await editor.expectEditor.toContain(
              `translate(bracket, x = 1, y = 2)
          scale(bracket, factor = 1.1)`,
              { shouldNormalise: true }
            )
          })

          await test.step('Edit scale on module', async () => {
            const op = await toolbar.getFeatureTreeOperation('Scale', 0)
            await op.dblclick()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Factor: '1.1',
              },
              commandName: 'Scale',
            })
            await cmdBar.clickHeaderArgument('factor')
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'factor',
              currentArgValue: '1.1',
              headerArguments: {
                Factor: '1.1',
              },
              highlightedHeaderArg: 'factor',
              commandName: 'Scale',
            })
            await page.keyboard.insertText('1.2')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Factor: '1.2',
              },
              commandName: 'Scale',
            })
            await cmdBar.submit()
            await scene.settled()
            await editor.expectEditor.toContain(
              `scale(bracket, factor = 1.2)`,
              {
                shouldNormalise: true,
              }
            )
          })

          await test.step('Set rotate on module', async () => {
            await toolbar.closePane(DefaultLayoutPaneID.Code)
            await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)

            await toolbar.selectTransform('rotate')
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'objects',
              currentArgValue: '',
              headerArguments: {
                Objects: '',
                Axis: 'Z',
                Angle: '45deg',
              },
              highlightedHeaderArg: 'objects',
              commandName: 'Rotate',
            })
            await selectBracket()
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'angle',
              currentArgValue: '45deg',
              headerArguments: {
                Objects: selectedObjects,
                Axis: 'Z',
                Angle: '45deg',
              },
              highlightedHeaderArg: 'angle',
              commandName: 'Rotate',
            })
            await page.keyboard.insertText('0.1')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Objects: selectedObjects,
                Axis: 'Z',
                Angle: '0.1',
              },
              commandName: 'Rotate',
            })
            await cmdBar.submit()
            await scene.settled()
            await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
            await toolbar.openPane(DefaultLayoutPaneID.Code)
            await editor.expectEditor.toContain(
              `
          translate(bracket, x = 1, y = 2)
          scale(bracket, factor = 1.2)
          rotate(bracket, axis = Z, angle = 0.1)
          `,
              { shouldNormalise: true }
            )
          })

          await test.step('Edit rotate on module', async () => {
            const op = await toolbar.getFeatureTreeOperation('Rotate', 0)
            await op.dblclick()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Axis: 'Z',
                Angle: '0.1',
              },
              commandName: 'Rotate',
            })
            await cmdBar.clickHeaderArgument('angle')
            await cmdBar.expectState({
              stage: 'arguments',
              currentArgKey: 'angle',
              currentArgValue: '0.1',
              headerArguments: {
                Axis: 'Z',
                Angle: '0.1',
              },
              highlightedHeaderArg: 'angle',
              commandName: 'Rotate',
            })
            await page.keyboard.insertText('0.2')
            await cmdBar.progressCmdBar()
            await cmdBar.expectState({
              stage: 'review',
              headerArguments: {
                Axis: 'Z',
                Angle: '0.2',
              },
              commandName: 'Rotate',
            })
            await cmdBar.submit()
            await scene.settled()
            await editor.expectEditor.toContain(
              `rotate(bracket, axis = Z, angle = 0.2)`,
              {
                shouldNormalise: true,
              }
            )
          })

          await test.step('Delete the part using the feature tree', async () => {
            await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
            await toolbar.openFeatureTreeOperationContextMenu('Rotate', 0)
            await page.getByTestId('context-menu-delete').click()
            await scene.settled()
            await toolbar.openFeatureTreeOperationContextMenu('Scale', 0)
            await page.getByTestId('context-menu-delete').click()
            await scene.settled()
            await toolbar.openFeatureTreeOperationContextMenu('Translate', 0)
            await page.getByTestId('context-menu-delete').click()
            await scene.settled()
            await selectBracket()
            await page.keyboard.press('Delete')
            await scene.settled()
            await scene.settled()
            await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

            // Expect empty editor and scene
            await toolbar.openPane(DefaultLayoutPaneID.Code)
            await editor.expectEditor.not.toContain('translate')
            await editor.expectEditor.not.toContain('scale')
            await editor.expectEditor.not.toContain('rotate')
          })
        }
        test(`Import the bracket part into an assembly and transform it (scene selection)`, async ({
          context,
          page,
          homePage,
          scene,
          editor,
          toolbar,
          cmdBar,
          tronApp,
          folderSetupFn,
        }) => {
          if (!tronApp) throwTronAppMissing()
          test.slow()
          await testBracketInsertionThenTransformsThenDeletion(
            context,
            page,
            homePage,
            scene,
            editor,
            toolbar,
            cmdBar,
            'scene',
            folderSetupFn
          )
        })
      }
    )

    test.describe('face-api-edge-selection.spec.ts', { tag: '@web' }, () => {
      const testCode = `@settings(kclVersion = "3.0-preview")
sketch001 = startSketchOn(YZ)
    profile001 = startProfile(sketch001, at = [-21.99, 8.01])
    |> angledLine(angle = 0deg, length = 8.96, tag = $rectangleSegmentA001)
    |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 9.8)
    |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile002 = startProfile(sketch001, at = [6.83, -2.24])
    |> line(end = [8.24, 12.65])
    |> line(end = [6.49, -12.52])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile003 = startProfile(sketch001, at = [6.11, -13.2])
    |> angledLine(angle = 0deg, length = 10.71, tag = $rectangleSegmentA002)
    |> angledLine(angle = segAng(rectangleSegmentA002) - 90deg, length = 9.54)
    |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile004 = circle(sketch001, center = [-1.16, -28.94], radius = 3.16)
    profile005 = circle(sketch001, center = [-7.82, 13.15], radius = 2.64)
    extrude001 = extrude(profile002, length = 15)
    extrude002 = extrude(profile003, length = 20, bodyType = SURFACE)
    sketch002 = startSketchOn(XZ)
    profile006 = startProfile(sketch002, at = [4.61, 11.1])
    |> line(end = [3.52, -1.94])
    |> line(end = [4.03, 1.84])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    extrude003 = extrude(profile006, length = -100)
    solid001 = subtract(extrude001, tools = extrude003)
`
      test('Can select split edges for fillet', async ({
        context,
        scene,
        cmdBar,
        page,
        toolbar,
        editor,
        homePage,
      }) => {
        const [clickEdge] = scene.makeMouseHelpers(0.1709, 0.4864, {
          format: 'ratio',
        })
        await context.addInitScript((code) => {
          localStorage.setItem('persistCode', code)
        }, testCode)

        await homePage.goToModelingScene()
        await scene.settled()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', testCode)
        )
        await editor.expectEditor.toContain('solid001 = subtract')

        // Set camera position for optimal edge viewing
        await scene.moveCameraTo(
          { x: 5.06, y: 25.19, z: 21.78 },
          { x: 7.72, y: 11.81, z: 8.2 }
        )

        // Click on the split edge using ratio clicks to select it first
        await clickEdge()

        // Base state object that we'll mutate as we progress
        const state: CmdBarSerialised = {
          commandName: 'Fillet',
          currentArgKey: 'selection',
          currentArgValue: '',
          headerArguments: {
            Selection: '',
            Radius: '',
          },
          highlightedHeaderArg: 'selection',
          stage: 'arguments',
        }

        // Click fillet tool - the edge should already be selected
        await toolbar.filletButton.click()
        await cmdBar.expectState(state)

        // Edge should already be selected, progress to radius
        state.currentArgKey = 'radius'
        state.currentArgValue = '5' // Default radius
        state.headerArguments.Selection = '1 edge'
        state.highlightedHeaderArg = 'radius'
        await cmdBar.progressCmdBar()
        await cmdBar.expectState(state)

        // Set radius to 0.75mm
        await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.75')
        state.currentArgValue = '0.75'
        state.headerArguments.Radius = '0.75'
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          commandName: state.commandName,
          headerArguments: state.headerArguments,
          stage: 'review',
          reviewValidationError: undefined,
        })

        await cmdBar.submit()

        // Assert code contains fillet
        await editor.expectEditor.toContain('fillet')

        // Final sanity check: assert no errors in code pane
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      })
    })

    test.describe(
      'face-api-selection-regressions.spec.ts',
      { tag: '@web' },
      () => {
        const edgeTreatmentCode = `@settings(defaultLengthUnit = mm, kclVersion = "3.0-preview")

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(region001, length = 12, tagEnd = $endCap)
chamfer001 = chamfer(
  body001,
  edges = [{ sideFaces = [endCap, region001.tags.left] }],
  length = 3,
)

hide(sketch001)`

        const shellCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 22])
  top = line(start = [30, 22], end = [0, 22])
  left = line(start = [0, 22], end = [0, 0])
}
region001 = region(point = [15, 11], sketch = sketch001)
body001 = extrude(region001, length = 14, tagEnd = $endCap)
shell001 = shell(body001, faces = endCap, thickness = 2)

hide(sketch001)`

        const csgSurfaceExtrudeCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

baseSketch = sketch(on = XY) {
  b1 = line(start = [0, 0], end = [26, 0])
  b2 = line(start = [26, 0], end = [26, 18])
  b3 = line(start = [26, 18], end = [0, 18])
  b4 = line(start = [0, 18], end = [0, 0])
}
baseRegion = region(point = [13, 9], sketch = baseSketch)
baseBody = extrude(baseRegion, length = 10, tagEnd = $baseEnd)

toolSketch = sketch(on = YZ) {
  t1 = line(start = [-2, 4], end = [12, 4])
  t2 = line(start = [12, 4], end = [12, 14])
  t3 = line(start = [12, 14], end = [-2, 14])
  t4 = line(start = [-2, 14], end = [-2, 4])
}
toolRegion = region(point = [5, 9], sketch = toolSketch)
toolBody = extrude(toolRegion, length = 30, symmetric = true)
cutBody = subtract(baseBody, tools = toolBody)

hide(baseSketch)
hide(toolSketch)`
        test('2.9 fillets a generated Chamfer boundary edge', async ({
          context,
          page,
          scene,
          cmdBar,
          editor,
          toolbar,
          tronApp,
          homePage,
        }) => {
          if (tronApp) await tronApp.cleanProjectDir()
          await context.addInitScript((code) => {
            localStorage.setItem('persistCode', code)
          }, edgeTreatmentCode)
          await page.setBodyDimensions({ width: 1200, height: 800 })
          await homePage.goToModelingScene()
          await scene.settled()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', edgeTreatmentCode)
          )
          await editor.closePane()
          await scene.moveCameraTo(
            { x: -3.14, y: -11, z: 16.25 },
            { x: 15, y: 10, z: 6 }
          )

          const [clickChamferBoundaryEdge] = scene.makeMouseHelpers(
            0.4091,
            0.5557,
            {
              format: 'ratio',
            }
          )
          await clickChamferBoundaryEdge()
          await expect(toolbar.selectionStatus).toContainText('1 edge')
          await toolbar.filletButton.click()
          await cmdBar.progressCmdBar()
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.3')
          await cmdBar.progressCmdBar()
          await cmdBar.submit()
          await scene.settled()

          await editor.expectEditor.toContain('tag = $')
          await editor.expectEditor.toContain('fillet001 = fillet(')
          await editor.expectEditor.toContain('edges = [')
          await editor.expectEditor.not.toContain('edgeId(')
        })

        test('2.10 fillets an outer Shell rim edge', async ({
          context,
          page,
          scene,
          cmdBar,
          editor,
          toolbar,
          tronApp,
          homePage,
        }) => {
          if (tronApp) await tronApp.cleanProjectDir()
          await context.addInitScript((code) => {
            localStorage.setItem('persistCode', code)
          }, shellCode)
          await page.setBodyDimensions({ width: 1200, height: 800 })
          await homePage.goToModelingScene()
          await scene.settled()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', shellCode)
          )
          await editor.closePane()
          await scene.moveCameraTo(
            { x: 48, y: -38, z: 34 },
            { x: 15, y: 11, z: 7 }
          )

          const [clickShellRimEdge] = scene.makeMouseHelpers(0.3679, 0.3356, {
            format: 'ratio',
          })
          await clickShellRimEdge()
          await expect(toolbar.selectionStatus).toContainText('1 edge')
          await toolbar.filletButton.click()
          await cmdBar.progressCmdBar()

          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Fillet',
            currentArgKey: 'radius',
            currentArgValue: '5',
            headerArguments: {
              Selection: '1 edge',
              Radius: '',
            },
            highlightedHeaderArg: 'radius',
          })
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('1')
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Fillet',
            headerArguments: {
              Selection: '1 edge',
              Radius: '1',
            },
            reviewValidationError: undefined,
          })
          await cmdBar.submit()
          await scene.settled()

          await editor.expectEditor.toContain('edgeId(body001')
          await editor.expectEditor.toContain('fillet001 = fillet(body001')
        })

        test('2.12 surface-extrudes an untouched outer CSG edge', async ({
          context,
          page,
          scene,
          cmdBar,
          editor,
          toolbar,
          tronApp,
          homePage,
        }) => {
          if (tronApp) await tronApp.cleanProjectDir()
          await context.addInitScript((code) => {
            localStorage.setItem('persistCode', code)
          }, csgSurfaceExtrudeCode)
          await page.setBodyDimensions({ width: 1200, height: 800 })
          await homePage.goToModelingScene()
          await scene.settled()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', csgSurfaceExtrudeCode)
          )
          await editor.closePane()
          await scene.moveCameraTo(
            { x: 48, y: -42, z: 34 },
            { x: 13, y: 9, z: 5 }
          )

          const [clickOuterCsgEdge] = scene.makeMouseHelpers(0.6081, 0.4918, {
            format: 'ratio',
          })
          await clickOuterCsgEdge()
          await toolbar.extrudeButton.click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Extrude',
            currentArgKey: 'sketches',
            currentArgValue: '',
            headerArguments: {
              Profiles: '',
              Length: '5',
            },
            highlightedHeaderArg: 'Profiles',
          })
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Extrude',
            currentArgKey: 'length',
            currentArgValue: '5',
            headerArguments: {
              Profiles: '1 edge',
              Length: '5',
            },
            highlightedHeaderArg: 'length',
          })
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('6')
          await cmdBar.progressCmdBar()
          await cmdBar.selectOption({ name: 'Surface' }).click()
          await cmdBar.selectOption({ name: 'New' }).click()
          await cmdBar.submit()
          await scene.settled()

          await editor.expectEditor.toContain('sideFaces = [')
          await editor.expectEditor.toContain('method = NEW')
        })
      }
    )
  }
)
