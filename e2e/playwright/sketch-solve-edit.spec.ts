import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { settingsToToml } from '@e2e/playwright/test-utils'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'

/**
 * Extract a specific line from code string (1-based line number).
 * Trims whitespace from the line.
 */
function getCodeLine({ code, line }: { code: string; line: number }): string {
  const lines = code.split('\n')
  if (line < 0 || line > lines.length) {
    throw new Error(`Line ${line} is out of range (1-${lines.length})`)
  }
  return lines[line].trim()
}

/**
 * Wait for the editor code to change from the previous code.
 * Returns the new code content after it has changed.
 */
async function waitForCodeChange(
  page: Page,
  previousCode: string
): Promise<string> {
  await expect(page.locator('.cm-content')).not.toHaveText(previousCode)
  return await page.locator('.cm-content').innerText()
}

/**
 * Normalize code by collapsing whitespace for stable equality checks.
 */
function normaliseCode(code: string): string {
  return code.replaceAll(/\s+/g, ' ').trim()
}

/**
 * Get the midpoint coordinates between two segment IDs.
 * Returns an object with x and y coordinates.
 */
async function getMidpointBetweenSegments(
  scene: SceneFixture,
  id1: string,
  id2: string
): Promise<{ x: number; y: number }> {
  const box1 = await scene.getBoundingBoxOrThrow(`[data-segment_id="${id1}"]`)
  const box2 = await scene.getBoundingBoxOrThrow(`[data-segment_id="${id2}"]`)

  const center1X = box1.x + box1.width / 2
  const center1Y = box1.y + box1.height / 2
  const center2X = box2.x + box2.width / 2
  const center2Y = box2.y + box2.height / 2

  return {
    x: (center1X + center2X) / 2,
    y: (center1Y + center2Y) / 2,
  }
}

/**
 * Click a segment by using its DOM element's position
 * The CSS2DObjects have been made invisible but they are kept for these tests.
 * Clicking on the DOM element directly was flaky.
 */
async function clickSegmentById(
  page: Page,
  scene: SceneFixture,
  segmentId: string
) {
  const box = await scene.getBoundingBoxOrThrow(
    `[data-segment_id="${segmentId}"]`
  )
  await page.mouse.click(box.x, box.y) // box size is 1x1 px so we can ignore width, height
}

async function dragBetweenRatios(
  page: Page,
  scene: SceneFixture,
  from: [number, number],
  to: [number, number],
  steps = 20
) {
  const fromPoint = await scene.convertPagePositionToStream(
    from[0],
    from[1],
    'ratio'
  )
  const toPoint = await scene.convertPagePositionToStream(to[0], to[1], 'ratio')

  await page.mouse.move(fromPoint.x, fromPoint.y)
  await page.mouse.down()
  await page.mouse.move(toPoint.x, toPoint.y, { steps })
  await page.mouse.up()
}

const TEST_CODE = `mySketch = startSketchOn(XZ)
myProfile = startProfile(mySketch, at = [0, 1])
  |> line(end = [-2.5, 3.75])
sketch(on = XZ) {
  line(start = [var -0.88mm, var 0.54mm], end = [var 0.63mm, var 1.18mm])
  line(start = [var 0.85mm, var -0.57mm], end = [var -0.21mm, var 1.55mm])
  line(start = [var -1.59mm, var -0.49mm], end = [var 0.09mm, var -0.56mm])
  point(at = [var -1.44mm, var 1.16mm])
  point(at = [var -0.41mm, var 0.26mm])
  point(at = [var -0.36mm, var -1.23mm])
}
`

const userSettingsToml = settingsToToml({
  settings: {
    ...TEST_SETTINGS,
    modeling: {
      ...TEST_SETTINGS.modeling,
      use_sketch_solve_mode: true,
    },
  },
})

function withDefaultLengthUnitInches(code: string): string {
  return `@settings(defaultLengthUnit = in)
    
${code}`
}

test.describe('Sketch solve edit tests', { tag: '@desktop' }, () => {
  test("can edit an existing sketch and edit it's segments", async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    await test.step('Set up the app with test code', async () => {
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, TEST_CODE)

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      await editor.expectEditor.toContain('sketch(on = XZ)')
    })

    await test.step('Place cursor in sketch block and verify Edit Sketch button', async () => {
      await editor.scrollToText('line(start = [var -0.88mm, var 0.54mm]')
      await page.getByText('line(start = [var -0.88mm, var 0.54mm]').click()

      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeVisible()
    })

    await test.step('Open feature tree and enter sketch edit mode', async () => {
      await toolbar.openFeatureTreePane()
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })

      const solveSketchOperation = await toolbar.getFeatureTreeOperation(
        'Solve Sketch',
        0
      )
      await solveSketchOperation.dblclick()

      await page.waitForTimeout(600)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
    })

    await test.step('Verify point handles are visible', async () => {
      const pointHandles = page.locator('[data-handle="sketch-point-handle"]')
      await expect(pointHandles).toHaveCount(9)
    })

    await test.step('Drag point segment 13 down', async () => {
      const segmentBox = await scene.getBoundingBoxOrThrow(
        '[data-segment_id="14"]'
      )

      const centerX = segmentBox.x + segmentBox.width / 2
      const centerY = segmentBox.y + segmentBox.height / 2

      const lineToEdit = getCodeLine({ code: TEST_CODE, line: 9 })
      await editor.expectEditor.toContain(lineToEdit)

      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX, centerY + 50, { steps: 5 })
      await page.mouse.up()

      await page.waitForTimeout(500)

      await editor.expectEditor.not.toContain(lineToEdit)
    })

    await test.step('Drag line segment by dragging midpoint between points 8 and 9 down', async () => {
      const midpoint = await getMidpointBetweenSegments(scene, '9', '10')

      const lineToEdit = getCodeLine({ code: TEST_CODE, line: 6 })
      await editor.expectEditor.toContain(lineToEdit)

      await page.mouse.move(midpoint.x, midpoint.y)
      await page.mouse.down()
      await page.mouse.move(midpoint.x, midpoint.y + 50, { steps: 5 })
      await page.mouse.up()

      await page.waitForTimeout(500)

      await editor.expectEditor.not.toContain(lineToEdit)
    })
  })

  test('add new sketch, add segments and verify a constraint can be added', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const INITIAL_CODE = ''
    const pointHandles = page.locator('[data-handle="sketch-point-handle"]')

    await test.step('Set up the app with initial code and enable sketch solve mode', async () => {
      // Set useSketchSolveMode in user settings (it's stored at user level even though hideOnLevel is 'project')
      // This ensures it's available immediately when the app loads, regardless of IS_STAGING_OR_DEBUG
      if (tronApp) {
        // Electron: settings via file system using cleanProjectDir
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          // Set useSketchSolveMode in user settings
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: INITIAL_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Start a new sketch and select a plane', async () => {
      await toolbar.startSketchOnDefaultPlane('Top plane')
      await editor.expectEditor.toContain('sketch(on = XY) {')
    })

    await test.step('Add three line segments', async () => {
      await toolbar.lineBtn.click()
      await page.waitForTimeout(200) // Brief wait for tool to be active

      let previousCode = await editor.getCurrentCode()

      const cancelLineChaining = async () => {
        await page.waitForTimeout(60)
        return page.keyboard.press('Escape')
      }
      // First line segment
      const [line1Start] = scene.makeMouseHelpers(0.3, 0.4, {
        format: 'ratio',
      })
      const [line1End] = scene.makeMouseHelpers(0.3, 0.8, {
        format: 'ratio',
      })
      await line1Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line1End()
      previousCode = await waitForCodeChange(page, previousCode)
      await cancelLineChaining()
      previousCode = await waitForCodeChange(page, previousCode)
      await expect(pointHandles).toHaveCount(2)

      // Second line segment
      // Keep this start point away from the Y axis so origin/axis snapping
      // does not inject an extra horizontalDistance constraint.
      const [line2Start] = scene.makeMouseHelpers(0.6, 0.4, {
        format: 'ratio',
      })
      const [line2End] = scene.makeMouseHelpers(0.8, 0.3, {
        format: 'ratio',
      })
      await line2Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line2End()
      previousCode = await waitForCodeChange(page, previousCode)
      await cancelLineChaining()
      previousCode = await waitForCodeChange(page, previousCode)
      await expect(pointHandles).toHaveCount(4)

      // Third line segment
      const [line3Start] = scene.makeMouseHelpers(0.7, 0.4, {
        format: 'ratio',
      })
      const [line3End] = scene.makeMouseHelpers(0.15, 0.3, {
        format: 'ratio',
      })
      await line3Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line3End()
      previousCode = await waitForCodeChange(page, previousCode)
      await cancelLineChaining()
      await waitForCodeChange(page, previousCode)
      await expect(pointHandles).toHaveCount(6)
    })

    await test.step('Add three points', async () => {
      await page.getByTestId('point').click()

      let previousCode = await editor.getCurrentCode()

      // First point
      const [point1Click] = scene.makeMouseHelpers(0.2, 0.6, {
        format: 'ratio',
      })
      await point1Click()
      previousCode = await waitForCodeChange(page, previousCode)

      // Second point
      const [point2Click] = scene.makeMouseHelpers(0.5, 0.6, {
        format: 'ratio',
      })
      await point2Click()
      previousCode = await waitForCodeChange(page, previousCode)

      // Third point
      const [point3Click] = scene.makeMouseHelpers(0.6, 0.6, {
        format: 'ratio',
      })
      await point3Click()
      await waitForCodeChange(page, previousCode)
      await page.getByTestId('point').click()
    })

    await test.step('Select segments 2 and 9, then apply coincident constraint', async () => {
      await clickSegmentById(page, scene, '2')
      // await page.waitForTimeout(100)
      await clickSegmentById(page, scene, '9')
      // await page.waitForTimeout(100)

      // Click the coincident tool
      await page.getByTestId('coincident').click()

      await editor.expectEditor.toContain(
        'coincident([line1.start, line2.end])'
      )
      await page.waitForTimeout(100)
    })
    const [clearSelection] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })
    await test.step('Select lines between segments 2-3 and 5-6, then apply parallel constraint', async () => {
      await clearSelection()
      const segmentBox = await scene.getBoundingBoxOrThrow(
        '[data-segment_id="2"]'
      )
      const centerX = segmentBox.x + segmentBox.width / 2
      const centerY = segmentBox.y + segmentBox.height / 2
      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX + 200, centerY + 0, { steps: 5 })
      await page.mouse.up()
    })

    await test.step('Select lines between segments 2-3 and 5-6, then apply parallel constraint', async () => {
      // Click in dead space to clear selections
      const midpoint1_2 = await getMidpointBetweenSegments(scene, '2', '3')
      const midpoint4_5 = await getMidpointBetweenSegments(scene, '5', '6')

      await clearSelection()
      // await page.waitForTimeout(100)
      await page.mouse.click(midpoint1_2.x, midpoint1_2.y)
      // await page.waitForTimeout(100)
      await page.mouse.click(midpoint4_5.x, midpoint4_5.y)
      // await page.waitForTimeout(100)

      // Click the parallel tool
      // await page.waitForTimeout(100)
      await page.getByTestId('Parallel').click()

      await editor.expectEditor.toContain('parallel([line1, line3])')
    })

    await test.step('Create a circle in sketch solve mode and verify code updates', async () => {
      await toolbar.circleBtn.click()
      await expect(toolbar.circleBtn).toHaveAttribute('aria-pressed', 'true')

      let previousCode = await editor.getCurrentCode()
      const [circleCenterClick] = scene.makeMouseHelpers(0.75, 0.65, {
        format: 'ratio',
      })
      const [circleRadiusClick] = scene.makeMouseHelpers(0.85, 0.78, {
        format: 'ratio',
      })

      await circleCenterClick()
      previousCode = await waitForCodeChange(page, previousCode)
      await circleRadiusClick()
      await waitForCodeChange(page, previousCode)

      await editor.expectEditor.toContain('circle(start = [')
      await expect(pointHandles).toHaveCount(11)
    })
  })

  test('unequipping line tool should not drop committed segments from the scene', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const INITIAL_CODE = ''
    const pointHandles = page.locator('[data-handle="sketch-point-handle"]')
    const getLineCount = (code: string) => (code.match(/line\(/g) ?? []).length

    await test.step('Set up the app with initial code and enable sketch solve mode', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          localStorage.setItem('debug:mixed-history', '1')
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: INITIAL_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Start a new sketch and equip line tool', async () => {
      await toolbar.startSketchOnDefaultPlane('Top plane')
      await editor.expectEditor.toContain('sketch(on = XY) {')
      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('Draw first line and assert code plus scene', async () => {
      let previousCode = await editor.getCurrentCode()
      const [line1Start] = scene.makeMouseHelpers(0.3, 0.4, {
        format: 'ratio',
      })
      const [line1End] = scene.makeMouseHelpers(0.3, 0.8, {
        format: 'ratio',
      })

      await line1Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line1End()
      const codeAfterLine1 = await waitForCodeChange(page, previousCode)

      expect(getLineCount(codeAfterLine1)).toBe(1)
      await expect(pointHandles).toHaveCount(2)
    })

    await test.step('Click once to add second line and assert committed code plus scene', async () => {
      let previousCode = await editor.getCurrentCode()
      const [line2Click, moveToDraftLineEnd] = scene.makeMouseHelpers(
        0.8,
        0.3,
        {
          format: 'ratio',
        }
      )
      const [, moveDraftLine] = scene.makeMouseHelpers(0.7, 0.55, {
        format: 'ratio',
      })

      await moveToDraftLineEnd()
      await line2Click()
      const codeAfterLine2 = await waitForCodeChange(page, previousCode)

      expect(getLineCount(codeAfterLine2)).toBe(2)
      await expect(pointHandles).toHaveCount(4)

      await moveDraftLine()
      const codeWithDraftLine = await waitForCodeChange(page, codeAfterLine2)
      expect(getLineCount(codeWithDraftLine)).toBe(3)
      await expect(pointHandles).toHaveCount(6)
    })

    await test.step('Unequip line tool and assert committed code plus scene remain', async () => {
      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'false')

      const codeAfterUnequip = await editor.getCurrentCode()
      expect(getLineCount(codeAfterUnequip)).toBe(2)
      await expect(pointHandles).toHaveCount(4)
    })
  })

  test('undo still works after mixing point-click edits with direct kcl edits in sketch solve mode', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const INITIAL_CODE = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -11.38mm, var 3.66mm], end = [var -11.5mm, var 0.43mm])
}
`
    const pointHandles = page.locator('[data-handle="sketch-point-handle"]')
    const getLineCount = (code: string) => (code.match(/line\(/g) ?? []).length
    const pressUndo = async () => {
      await page.keyboard.press('ControlOrMeta+z')
    }
    const pressRedo = async () => {
      await page.keyboard.press('ControlOrMeta+Shift+z')
    }

    const addCommittedLine = async (
      start: [number, number],
      end: [number, number],
      options: { shouldUnequip?: boolean } = {}
    ) => {
      const shouldUnequip = options.shouldUnequip ?? true
      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')

      let previousCode = await editor.getCurrentCode()
      const [lineStart] = scene.makeMouseHelpers(start[0], start[1], {
        format: 'ratio',
      })
      const [lineEnd] = scene.makeMouseHelpers(end[0], end[1], {
        format: 'ratio',
      })

      await lineStart()
      previousCode = await waitForCodeChange(page, previousCode)
      await lineEnd()
      const committedCode = await waitForCodeChange(page, previousCode)

      if (shouldUnequip) {
        await toolbar.lineBtn.click()
        await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'false')
      }

      return committedCode
    }

    await test.step('Set up the app with initial sketch code and enable sketch solve mode', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: INITIAL_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 600 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch001 = sketch(on = XY) {')
    })

    await test.step('Enter sketch edit mode', async () => {
      await toolbar.openFeatureTreePane()
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })
      const sketchOperation = await toolbar.getFeatureTreeOperation(
        'sketch001',
        0
      )
      await sketchOperation.dblclick()
      await page.waitForTimeout(600)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await expect(pointHandles).toHaveCount(2)
    })

    const initialCode = await editor.getCurrentCode()

    await test.step('Add a second line, unequip, and verify committed state', async () => {
      const codeWithCommittedLine2 = await addCommittedLine(
        [0.72, 0.32],
        [0.82, 0.46],
        { shouldUnequip: true }
      )

      expect(getLineCount(codeWithCommittedLine2)).toBe(2)
      await expect(pointHandles).toHaveCount(4)

      const codeAfterUnequip = await editor.getCurrentCode()
      expect(getLineCount(codeAfterUnequip)).toBe(2)
      await expect(pointHandles).toHaveCount(4)
    })

    const codeBeforeFirstPointClickEdit = await editor.getCurrentCode()

    await test.step('Add a third line and assert code plus scene', async () => {
      const codeAfterFirstPointClickEdit = await addCommittedLine(
        [0.63, 0.24],
        [0.69, 0.63],
        { shouldUnequip: true }
      )

      expect(normaliseCode(codeAfterFirstPointClickEdit)).not.toBe(
        normaliseCode(codeBeforeFirstPointClickEdit)
      )
      expect(getLineCount(codeAfterFirstPointClickEdit)).toBe(3)
      await expect(pointHandles).toHaveCount(6)
    })

    const codeAfterFirstPointClickEdit = await editor.getCurrentCode()

    await test.step('Directly remove line2 in the editor and wait for execution', async () => {
      const lineToRemove = codeAfterFirstPointClickEdit
        .split('\n')
        .find(
          (line) =>
            line.includes('line(') &&
            !line.includes('line1 = line(') &&
            line.trim() !== '}'
        )
      expect(lineToRemove).toBeDefined()
      if (!lineToRemove) {
        throw new Error('Expected added line to exist before direct edit')
      }

      await editor.replaceCodeByTyping(`${lineToRemove}\n`, '')
      await expect(pointHandles).toHaveCount(4)

      const codeAfterDirectEdit = await editor.getCurrentCode()
      expect(getLineCount(codeAfterDirectEdit)).toBe(2)
      expect(normaliseCode(codeAfterDirectEdit)).not.toBe(
        normaliseCode(codeAfterFirstPointClickEdit)
      )
      await expect(pointHandles).toHaveCount(4)
    })

    const codeAfterDirectEdit = await editor.getCurrentCode()

    await test.step('Make one more point-click edit and assert code plus scene', async () => {
      const codeAfterSecondPointClickEdit = await addCommittedLine(
        [0.33, 0.64],
        [0.4, 0.28],
        { shouldUnequip: false }
      )

      expect(normaliseCode(codeAfterSecondPointClickEdit)).not.toBe(
        normaliseCode(codeAfterDirectEdit)
      )
      expect(getLineCount(codeAfterSecondPointClickEdit)).toBe(3)
      await expect(pointHandles).toHaveCount(6)
    })

    const codeAfterSecondPointClickEdit = await editor.getCurrentCode()

    await test.step('Undo the last point-click edit, the direct edit, and the first point-click edit', async () => {
      await pressUndo()
      const codeAfterUndo1 = await waitForCodeChange(
        page,
        codeAfterSecondPointClickEdit
      )
      expect(normaliseCode(codeAfterUndo1)).toBe(
        normaliseCode(codeAfterDirectEdit)
      )
      expect(getLineCount(codeAfterUndo1)).toBe(2)
      await expect(pointHandles).toHaveCount(4)

      await pressUndo()
      const codeAfterUndo2 = await waitForCodeChange(page, codeAfterUndo1)
      expect(normaliseCode(codeAfterUndo2)).toBe(
        normaliseCode(codeAfterFirstPointClickEdit)
      )
      expect(getLineCount(codeAfterUndo2)).toBe(3)
      await expect(pointHandles).toHaveCount(6)

      await pressUndo()
      const codeAfterUndo3 = await waitForCodeChange(page, codeAfterUndo2)
      expect(normaliseCode(codeAfterUndo3)).toBe(
        normaliseCode(codeBeforeFirstPointClickEdit)
      )
      expect(normaliseCode(codeAfterUndo3)).not.toBe(normaliseCode(initialCode))
      expect(getLineCount(codeAfterUndo3)).toBe(2)
      await expect(pointHandles).toHaveCount(4)

      await pressRedo()
      const codeAfterRedo1 = await waitForCodeChange(page, codeAfterUndo3)
      expect(normaliseCode(codeAfterRedo1)).toBe(
        normaliseCode(codeAfterFirstPointClickEdit)
      )
      expect(getLineCount(codeAfterRedo1)).toBe(3)
      await expect(pointHandles).toHaveCount(6)

      await pressRedo()
      const codeAfterRedo2 = await waitForCodeChange(page, codeAfterRedo1)
      expect(normaliseCode(codeAfterRedo2)).toBe(
        normaliseCode(codeAfterDirectEdit)
      )
      expect(getLineCount(codeAfterRedo2)).toBe(2)
      await expect(pointHandles).toHaveCount(4)

      await pressRedo()
      const codeAfterRedo3 = await waitForCodeChange(page, codeAfterRedo2)
      expect(normaliseCode(codeAfterRedo3)).toBe(
        normaliseCode(codeAfterSecondPointClickEdit)
      )
      expect(getLineCount(codeAfterRedo3)).toBe(3)
      await expect
        .poll(async () => [6, 8].includes(await pointHandles.count()))
        .toBe(true)
    })
  })

  test('undoing center arcs removes one arc at a time in sketch solve mode', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const pointHandles = page.locator('[data-handle="sketch-point-handle"]')
    const INITIAL_CODE = ''

    await test.step('Set up app with sketch solve mode enabled', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: INITIAL_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Start a new sketch and equip center arc', async () => {
      await toolbar.startSketchOnDefaultPlane('Top plane')
      await editor.expectEditor.toContain('sketch(on = XY) {')

      await page.getByRole('button', { name: 'caret down arcs:' }).click()
      await expect(page.getByTestId('dropdown-center-arc')).toBeVisible()
      await page.getByTestId('dropdown-center-arc').click()
    })

    const addCenterArc = async ({
      center,
      start,
      end,
      previousCode,
    }: {
      center: [number, number]
      start: [number, number]
      end: [number, number]
      previousCode: string
    }) => {
      const [clickCenter] = scene.makeMouseHelpers(center[0], center[1], {
        format: 'ratio',
      })
      const [clickStart] = scene.makeMouseHelpers(start[0], start[1], {
        format: 'ratio',
      })
      const [clickEnd] = scene.makeMouseHelpers(end[0], end[1], {
        format: 'ratio',
      })

      await clickCenter()
      await clickStart()
      let nextCode = await waitForCodeChange(page, previousCode)
      await clickEnd()
      nextCode = await waitForCodeChange(page, nextCode)
      return nextCode
    }

    const pressUndo = async () => {
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Control')
    }

    const getCodeCounts = (code: string) => ({
      arcs: (code.match(/arc\(/g) ?? []).length,
      circles: (code.match(/circle\(/g) ?? []).length,
      lines: (code.match(/line\(/g) ?? []).length,
      coincidents: (code.match(/coincident\(/g) ?? []).length,
      tangents: (code.match(/tangent\(/g) ?? []).length,
    })

    let previousCode = await editor.getCurrentCode()
    const codeAfterSketchStart = previousCode

    await test.step('Add three center arcs and undo three times', async () => {
      previousCode = await addCenterArc({
        center: [0.25, 0.4],
        start: [0.35, 0.4],
        end: [0.31, 0.48],
        previousCode,
      })
      const codeAfterArc1 = previousCode
      expect((codeAfterArc1.match(/arc\(/g) ?? []).length).toBe(1)
      await expect(pointHandles).toHaveCount(3)

      previousCode = await addCenterArc({
        center: [0.55, 0.35],
        start: [0.65, 0.35],
        end: [0.62, 0.43],
        previousCode,
      })
      const codeAfterArc2 = previousCode
      expect((codeAfterArc2.match(/arc\(/g) ?? []).length).toBe(2)
      await expect(pointHandles).toHaveCount(6)

      previousCode = await addCenterArc({
        center: [0.45, 0.65],
        start: [0.55, 0.65],
        end: [0.52, 0.74],
        previousCode,
      })
      const codeAfterArc3 = previousCode
      expect((codeAfterArc3.match(/arc\(/g) ?? []).length).toBe(3)
      await expect(pointHandles).toHaveCount(9)

      await pressUndo()
      await expect(page.locator('.cm-content')).not.toHaveText(codeAfterArc3)
      const codeAfterUndo1 = await editor.getCurrentCode()
      expect(normaliseCode(codeAfterUndo1)).toBe(normaliseCode(codeAfterArc2))
      expect((codeAfterUndo1.match(/arc\(/g) ?? []).length).toBe(2)
      expect(
        (codeAfterUndo1.match(/sketch\(on\s*=\s*XY\)\s*\{/g) ?? []).length
      ).toBe(1)
      await expect(pointHandles).toHaveCount(6)

      await pressUndo()
      await expect(page.locator('.cm-content')).not.toHaveText(codeAfterUndo1)
      const codeAfterUndo2 = await editor.getCurrentCode()
      expect(normaliseCode(codeAfterUndo2)).toBe(normaliseCode(codeAfterArc1))
      expect((codeAfterUndo2.match(/arc\(/g) ?? []).length).toBe(1)
      expect(
        (codeAfterUndo2.match(/sketch\(on\s*=\s*XY\)\s*\{/g) ?? []).length
      ).toBe(1)
      await expect(pointHandles).toHaveCount(3)

      await pressUndo()
      await expect(page.locator('.cm-content')).not.toHaveText(codeAfterUndo2)
      const codeAfterUndo3 = await editor.getCurrentCode()
      expect(normaliseCode(codeAfterUndo3)).toBe(
        normaliseCode(codeAfterSketchStart)
      )
      expect((codeAfterUndo3.match(/arc\(/g) ?? []).length).toBe(0)
      expect(
        (codeAfterUndo3.match(/sketch\(on\s*=\s*XY\)\s*\{/g) ?? []).length
      ).toBe(1)
      await expect(pointHandles).toHaveCount(0)

      previousCode = await addCenterArc({
        center: [0.25, 0.4],
        start: [0.35, 0.4],
        end: [0.31, 0.48],
        previousCode: codeAfterUndo3,
      })
      const codeAfterAddingNewArcPostUndo = previousCode
      expect(normaliseCode(codeAfterAddingNewArcPostUndo)).toBe(
        normaliseCode(codeAfterArc1)
      )
      expect((codeAfterAddingNewArcPostUndo.match(/arc\(/g) ?? []).length).toBe(
        1
      )
      expect(
        (
          codeAfterAddingNewArcPostUndo.match(/sketch\(on\s*=\s*XY\)\s*\{/g) ??
          []
        ).length
      ).toBe(1)

      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')

      const [line1Start] = scene.makeMouseHelpers(0.62, 0.3, {
        format: 'ratio',
      })
      const [line1End] = scene.makeMouseHelpers(0.72, 0.3, {
        format: 'ratio',
      })
      const [line2End] = scene.makeMouseHelpers(0.72, 0.42, {
        format: 'ratio',
      })
      const [line3End] = scene.makeMouseHelpers(0.62, 0.42, {
        format: 'ratio',
      })

      await line1Start()
      previousCode = await waitForCodeChange(
        page,
        codeAfterAddingNewArcPostUndo
      )

      await line1End()
      previousCode = await waitForCodeChange(page, previousCode)
      let counts = getCodeCounts(previousCode)
      expect(counts.arcs).toBe(1)
      expect(counts.lines).toBe(1)
      expect(counts.coincidents).toBe(0)
      await expect(pointHandles).toHaveCount(5)

      await line2End()
      previousCode = await waitForCodeChange(page, previousCode)
      counts = getCodeCounts(previousCode)
      expect(counts.lines).toBe(2)
      expect(counts.coincidents).toBe(1)
      await expect(pointHandles).toHaveCount(7)

      await line3End()
      previousCode = await waitForCodeChange(page, previousCode)
      const codeAfterThreeLines = previousCode
      counts = getCodeCounts(codeAfterThreeLines)
      expect(counts.lines).toBe(3)
      expect(counts.coincidents).toBe(2)
      await expect(pointHandles).toHaveCount(9)

      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'false')

      const codeAfterUnequipLineTool = await editor.getCurrentCode()
      counts = getCodeCounts(codeAfterUnequipLineTool)
      expect(counts.lines).toBe(3)
      expect(counts.coincidents).toBe(2)

      const pointHandleCountBeforeLineUndo = await pointHandles.count()

      await pressUndo()
      const codeAfterLineUndo = await editor.getCurrentCode()
      counts = getCodeCounts(codeAfterLineUndo)
      expect(counts.arcs).toBe(1)
      expect(counts.lines).toBe(2)
      expect(counts.coincidents).toBe(1)
      await expect(pointHandles).toHaveCount(pointHandleCountBeforeLineUndo - 2)

      await pressUndo()
      const codeAfterSecondLineUndo = await editor.getCurrentCode()
      counts = getCodeCounts(codeAfterSecondLineUndo)
      expect(counts.arcs).toBe(1)
      expect(counts.lines).toBe(1)
      expect(counts.coincidents).toBe(0)
      await expect(pointHandles).toHaveCount(pointHandleCountBeforeLineUndo - 4)

      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')

      const [newLineStart] = scene.makeMouseHelpers(0.72, 0.3, {
        format: 'ratio',
      })
      const [newLineEnd] = scene.makeMouseHelpers(0.8, 0.38, {
        format: 'ratio',
      })

      await newLineStart()
      previousCode = await waitForCodeChange(page, codeAfterSecondLineUndo)

      await newLineEnd()
      previousCode = await waitForCodeChange(page, previousCode)

      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'false')

      const codeAfterAddingLinePostUndo = await editor.getCurrentCode()
      counts = getCodeCounts(codeAfterAddingLinePostUndo)
      expect(counts.arcs).toBe(1)
      expect(counts.lines).toBe(2)
      expect(counts.coincidents).toBe(1)
      expect(
        (codeAfterAddingLinePostUndo.match(/sketch\(on\s*=\s*XY\)\s*\{/g) ?? [])
          .length
      ).toBe(1)
      await expect(pointHandles).toHaveCount(pointHandleCountBeforeLineUndo - 2)

      const codeBeforePointDrag = await editor.getCurrentCode()
      const pointDragCountsBefore = getCodeCounts(codeBeforePointDrag)
      const pointHandleCountBeforePointDrag = await pointHandles.count()
      const firstPointHandleBox = await pointHandles.first().boundingBox()
      expect(firstPointHandleBox).not.toBeNull()
      if (!firstPointHandleBox) {
        throw new Error('Expected first point handle to have a bounding box')
      }

      const firstPointHandleX =
        firstPointHandleBox.x + firstPointHandleBox.width / 2
      const firstPointHandleY =
        firstPointHandleBox.y + firstPointHandleBox.height / 2

      await page.mouse.move(firstPointHandleX, firstPointHandleY)
      await page.mouse.down()
      await page.mouse.move(firstPointHandleX + 40, firstPointHandleY + 30, {
        steps: 5,
      })
      await page.mouse.up()
      await page.waitForTimeout(300)

      const codeAfterPointDrag = await waitForCodeChange(
        page,
        codeBeforePointDrag
      )
      counts = getCodeCounts(codeAfterPointDrag)
      expect(normaliseCode(codeAfterPointDrag)).not.toBe(
        normaliseCode(codeBeforePointDrag)
      )
      expect(counts).toEqual(pointDragCountsBefore)
      await expect(pointHandles).toHaveCount(pointHandleCountBeforePointDrag)

      await pressUndo()
      const codeAfterPointDragUndo = await editor.getCurrentCode()
      expect(normaliseCode(codeAfterPointDragUndo)).toBe(
        normaliseCode(codeBeforePointDrag)
      )
      await expect(pointHandles).toHaveCount(pointHandleCountBeforePointDrag)

      const circleCodeBefore = await editor.getCurrentCode()
      const circleCountsBefore = getCodeCounts(circleCodeBefore)
      const circlePointHandlesBefore = await pointHandles.count()

      await toolbar.circleBtn.click()
      await expect(toolbar.circleBtn).toHaveAttribute('aria-pressed', 'true')

      const [circleCenterClick] = scene.makeMouseHelpers(0.24, 0.72, {
        format: 'ratio',
      })
      const [circleRadiusClick] = scene.makeMouseHelpers(0.31, 0.8, {
        format: 'ratio',
      })

      await circleCenterClick()
      previousCode = await waitForCodeChange(page, circleCodeBefore)
      await circleRadiusClick()
      const circleCodeAfter = await waitForCodeChange(page, previousCode)
      counts = getCodeCounts(circleCodeAfter)
      expect(counts.circles).toBe(circleCountsBefore.circles + 1)
      expect(await pointHandles.count()).toBeGreaterThan(
        circlePointHandlesBefore
      )

      await pressUndo()
      const circleCodeAfterUndo = await editor.getCurrentCode()
      expect(normaliseCode(circleCodeAfterUndo)).toBe(
        normaliseCode(circleCodeBefore)
      )
      const circleHandlesAfterUndo = await pointHandles.count()
      expect(circleHandlesAfterUndo).toBeGreaterThanOrEqual(
        circlePointHandlesBefore - 1
      )
      expect(circleHandlesAfterUndo).toBeLessThanOrEqual(
        circlePointHandlesBefore + 1
      )

      const tangentialCodeBefore = await editor.getCurrentCode()
      const tangentialCountsBefore = getCodeCounts(tangentialCodeBefore)
      const tangentialPointHandlesBefore = await pointHandles.count()

      await toolbar.selectTangentialArc()

      const [tangentialStartClick] = scene.makeMouseHelpers(0.8, 0.38, {
        format: 'ratio',
      })
      const [tangentialEndClick] = scene.makeMouseHelpers(0.88, 0.48, {
        format: 'ratio',
      })

      await tangentialStartClick()
      previousCode = await waitForCodeChange(page, tangentialCodeBefore)
      await tangentialEndClick()
      const tangentialCodeAfter = await waitForCodeChange(page, previousCode)
      counts = getCodeCounts(tangentialCodeAfter)
      expect(counts.arcs).toBe(tangentialCountsBefore.arcs + 1)
      expect(counts.coincidents).toBe(tangentialCountsBefore.coincidents + 1)
      expect(counts.tangents).toBe(tangentialCountsBefore.tangents + 1)
      expect(await pointHandles.count()).toBeGreaterThan(
        tangentialPointHandlesBefore
      )

      await pressUndo()
      const tangentialCodeAfterUndo = await editor.getCurrentCode()
      expect(normaliseCode(tangentialCodeAfterUndo)).toBe(
        normaliseCode(tangentialCodeBefore)
      )
      const tangentialHandlesAfterUndo = await pointHandles.count()
      expect(tangentialHandlesAfterUndo).toBeGreaterThanOrEqual(
        tangentialPointHandlesBefore - 1
      )
      expect(tangentialHandlesAfterUndo).toBeLessThanOrEqual(
        tangentialPointHandlesBefore + 1
      )

      const threePointCodeBefore = await editor.getCurrentCode()
      const threePointCountsBefore = getCodeCounts(threePointCodeBefore)
      const threePointHandlesBefore = await pointHandles.count()

      await toolbar.selectThreePointArc()

      const [threePointStartClick] = scene.makeMouseHelpers(0.34, 0.58, {
        format: 'ratio',
      })
      const [threePointThroughClick] = scene.makeMouseHelpers(0.42, 0.48, {
        format: 'ratio',
      })
      const [threePointEndClick] = scene.makeMouseHelpers(0.5, 0.58, {
        format: 'ratio',
      })

      await threePointStartClick()
      previousCode = await waitForCodeChange(page, threePointCodeBefore)
      await threePointThroughClick()
      previousCode = await waitForCodeChange(page, previousCode)
      await threePointEndClick()
      const threePointCodeAfter = await waitForCodeChange(page, previousCode)
      counts = getCodeCounts(threePointCodeAfter)
      expect(counts.arcs).toBe(threePointCountsBefore.arcs + 1)
      expect(counts.coincidents).toBe(threePointCountsBefore.coincidents + 1)
      expect(await pointHandles.count()).toBeGreaterThan(
        threePointHandlesBefore
      )

      await pressUndo()
      const threePointCodeAfterUndo = await editor.getCurrentCode()
      expect(normaliseCode(threePointCodeAfterUndo)).toBe(
        normaliseCode(threePointCodeBefore)
      )
      const threePointHandlesAfterUndo = await pointHandles.count()
      expect(threePointHandlesAfterUndo).toBeGreaterThanOrEqual(
        threePointHandlesBefore - 1
      )
      expect(threePointHandlesAfterUndo).toBeLessThanOrEqual(
        threePointHandlesBefore + 1
      )
    })
  })

  test('constraints can be added and undone one at a time in sketch solve mode', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const CONSTRAINT_TEST_CODE = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -11.38mm, var 3.66mm], end = [var -11.5mm, var 0.43mm])
  line2 = line(start = [var -10.75mm, var 2.17mm], end = [var -9.21mm, var 2.05mm])
  line3 = line(start = [var -10.86mm, var 0.39mm], end = [var -9.48mm, var 0.39mm])
  line4 = line(start = [var -7.79mm, var 0.28mm], end = [var -7.75mm, var 1.93mm])
  arc(start = [var -7.33mm, var 3.65mm], end = [var -7.75mm, var 2.6mm], center = [var -6.01mm, var 2.52mm])
  line5 = line(start = [var -5.15mm, var 1.14mm], end = [var -4.36mm, var 2.87mm])
  line6 = line(start = [var -3.73mm, var 2.87mm], end = [var -2.98mm, var 0.91mm])
  line7 = line(start = [var -1.76mm, var 3.42mm], end = [var -1.76mm, var 1.22mm])
  line8 = line(start = [var -1.28mm, var 2.32mm], end = [var 0.06mm, var 3.35mm])
  line9 = line(start = [var 2.31mm, var 3.27mm], end = [var 1.91mm, var 0.16mm])
  line10 = line(start = [var 2.98mm, var 1.73mm], end = [var 3.05mm, var 2.64mm])
  line(start = [var 5.18mm, var 2.68mm], end = [var 7mm, var 1.1mm])
  line11 = line(start = [var 7.31mm, var 2.87mm], end = [var 8.89mm, var 1.38mm])
  point(at = [var -11.14mm, var -3.58mm])
  line12 = line(start = [var -8.74mm, var -2.36mm], end = [var -7.36mm, var -4.33mm])
  line13 = line(start = [var -5.7mm, var -2.24mm], end = [var -4.71mm, var -3.98mm])
  line(start = [var -3.49mm, var -2.36mm], end = [var -2.35mm, var -4.61mm])
  line14 = line(start = [var -0.85mm, var -2.17mm], end = [var 0.89mm, var -4.21mm])
}
`

    await test.step('Set up app with existing sketch code in sketch solve mode', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: CONSTRAINT_TEST_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1400, height: 900 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch001 = sketch(on = XY) {')
    })

    await test.step('Enter sketch edit mode', async () => {
      await toolbar.openFeatureTreePane()
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })
      const sketchOperation = await toolbar.getFeatureTreeOperation(
        'sketch001',
        0
      )
      await sketchOperation.dblclick()
      await page.waitForTimeout(600)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
    })

    const pressUndo = async () => {
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Control')
    }

    const clickMidpoint = async (id1: string, id2: string) => {
      const midpoint = await getMidpointBetweenSegments(scene, id1, id2)
      await page.mouse.click(midpoint.x, midpoint.y)
    }

    const clickPoint = async (segmentId: string) => {
      await clickSegmentById(page, scene, segmentId)
    }

    const initialCode = await editor.getCurrentCode()
    const getHandleIds = async () =>
      await page
        .locator('[data-segment_id]')
        .evaluateAll((els) =>
          els
            .map((el) => el.getAttribute('data-segment_id'))
            .filter((value): value is string => Boolean(value))
        )
    const initialHandleIds = await getHandleIds()

    const expectBackToInitialCode = async (changedCode: string) => {
      await pressUndo()
      const undoneCode = await waitForCodeChange(page, changedCode)
      expect(normaliseCode(undoneCode)).toBe(normaliseCode(initialCode))
      await expect
        .poll(async () => JSON.stringify(await getHandleIds()), {
          timeout: 10000,
        })
        .toBe(JSON.stringify(initialHandleIds))
    }

    const applyConstraintStep = async ({
      label,
      select,
      apply,
      assertChanged,
    }: {
      label: string
      select: () => Promise<void>
      apply: () => Promise<void>
      assertChanged: (code: string) => void
    }) => {
      await test.step(label, async () => {
        await scene.clickNoWhere()
        const codeBefore = await editor.getCurrentCode()
        expect(normaliseCode(codeBefore)).toBe(normaliseCode(initialCode))

        await select()
        await apply()

        const changedCode = await waitForCodeChange(page, codeBefore)
        assertChanged(changedCode)

        await expectBackToInitialCode(changedCode)
        await scene.clickNoWhere()
      })
    }

    await applyConstraintStep({
      label: 'coincident 1',
      select: async () => {
        await clickMidpoint('2', '3')
        await clickPoint('5')
      },
      apply: async () => {
        await page.getByTestId('coincident').click()
      },
      assertChanged: (code) => {
        expect((code.match(/coincident\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'coincident 2',
      select: async () => {
        await clickPoint('3')
        await clickPoint('8')
      },
      apply: async () => {
        await page.getByTestId('coincident').click()
      },
      assertChanged: (code) => {
        expect((code.match(/coincident\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'tangent',
      select: async () => {
        await clickMidpoint('11', '12')
        await clickMidpoint('14', '15')
      },
      apply: async () => {
        await page.getByTestId('Tangent').click()
      },
      assertChanged: (code) => {
        expect((code.match(/tangent\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'parallel',
      select: async () => {
        await clickMidpoint('18', '19')
        await clickMidpoint('21', '22')
      },
      apply: async () => {
        await page.getByTestId('Parallel').click()
      },
      assertChanged: (code) => {
        expect((code.match(/parallel\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'perpendicular',
      select: async () => {
        await clickMidpoint('24', '25')
        await clickMidpoint('27', '28')
      },
      apply: async () => {
        await page.getByTestId('Perpendicular').click()
      },
      assertChanged: (code) => {
        expect((code.match(/perpendicular\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'equal length',
      select: async () => {
        await clickMidpoint('30', '31')
        await clickMidpoint('33', '34')
      },
      apply: async () => {
        await page.getByTestId('equalLength').click()
      },
      assertChanged: (code) => {
        expect((code.match(/equalLength\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'vertical',
      select: async () => {
        await clickMidpoint('36', '37')
      },
      apply: async () => {
        await page.getByTestId('vertical').click()
      },
      assertChanged: (code) => {
        expect((code.match(/vertical\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'horizontal',
      select: async () => {
        await clickMidpoint('39', '40')
      },
      apply: async () => {
        await page.getByTestId('Horizontal').click()
      },
      assertChanged: (code) => {
        expect((code.match(/horizontal\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'fixed',
      select: async () => {
        await clickPoint('42')
      },
      apply: async () => {
        await page.getByTestId('Fixed').click()
      },
      assertChanged: (code) => {
        expect(code).toMatch(/fixed\(|coincident\(/)
      },
    })

    await applyConstraintStep({
      label: 'length',
      select: async () => {
        await clickMidpoint('43', '44')
      },
      apply: async () => {
        await page.getByTestId('Dimension').click()
      },
      assertChanged: (code) => {
        expect((code.match(/distance\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'horizontal length',
      select: async () => {
        await clickMidpoint('46', '47')
      },
      apply: async () => {
        await page.getByTestId('HorizontalDistance').click()
      },
      assertChanged: (code) => {
        expect((code.match(/horizontalDistance\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'vertical length',
      select: async () => {
        await clickMidpoint('49', '50')
      },
      apply: async () => {
        await page.getByTestId('VerticalDistance').click()
      },
      assertChanged: (code) => {
        expect((code.match(/verticalDistance\(/g) ?? []).length).toBe(1)
      },
    })

    await applyConstraintStep({
      label: 'construction',
      select: async () => {
        await clickMidpoint('52', '53')
      },
      apply: async () => {
        await page.getByTestId('construction').click()
      },
      assertChanged: (code) => {
        expect(code).toContain('construction = true')
      },
    })
  })

  test('trim operations can be undone in sketch solve mode', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const TRIM_TEST_CODE = `sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -8.66mm, var 2.52mm], end = [var -8.77mm, var -2.76mm])
  line(start = [var -6.49mm, var 2.4mm], end = [var -6.45mm, var -2.72mm])
  line2 = line(start = [var -10mm, var -0.31mm], end = [var -5.38mm, var 0.2mm])
  line3 = line(start = [var 4.47mm, var 1.73mm], end = [var 4.12mm, var -3.03mm])
  line4 = line(start = [var 2.27mm, var -2.4mm], end = [var 6.25mm, var 1.1mm])
  line5 = line(start = [var 5.26mm, var -3.98mm], end = [var 8.06mm, var 0.35mm])
  line6 = line(start = [var 7.23mm, var -3.78mm], end = [var 5.7mm, var -2.52mm])
}
`
    const pointHandles = page.locator('[data-handle="sketch-point-handle"]')

    await test.step('Set up app with trim fixture in sketch solve mode', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: TRIM_TEST_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1400, height: 900 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch001 = sketch(on = YZ) {')
    })

    await test.step('Enter sketch edit mode and equip trim tool', async () => {
      await toolbar.openFeatureTreePane()
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })
      const sketchOperation = await toolbar.getFeatureTreeOperation(
        'sketch001',
        0
      )
      await sketchOperation.dblclick()
      await page.waitForTimeout(600)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await page.getByTestId('trim').click()
    })

    const pressUndo = async () => {
      await page.keyboard.down('Control')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Control')
    }
    const getHandleIds = async () =>
      await page
        .locator('[data-segment_id]')
        .evaluateAll((els) =>
          els
            .map((el) => el.getAttribute('data-segment_id'))
            .filter((value): value is string => Boolean(value))
        )

    const initialCode = await editor.getCurrentCode()
    const initialHandleCount = await pointHandles.count()
    const initialHandleIds = await getHandleIds()

    await test.step('Trim first region and undo', async () => {
      await dragBetweenRatios(page, scene, [0.1467, 0.4583], [0.1454, 0.5452])

      const trimmedCode = await waitForCodeChange(page, initialCode)
      expect(normaliseCode(trimmedCode)).not.toBe(normaliseCode(initialCode))

      const handleCountAfterTrim = await pointHandles.count()
      const handleIdsAfterTrim = await getHandleIds()
      expect(
        handleCountAfterTrim !== initialHandleCount ||
          normaliseCode(handleIdsAfterTrim.join(',')) !==
            normaliseCode(initialHandleIds.join(','))
      ).toBe(true)

      await pressUndo()
      const undoneCode = await waitForCodeChange(page, trimmedCode)
      expect(normaliseCode(undoneCode)).toBe(normaliseCode(initialCode))
      await expect(pointHandles).toHaveCount(initialHandleCount)
    })

    await test.step('Trim second region and undo', async () => {
      const codeBeforeSecondTrim = await editor.getCurrentCode()
      expect(normaliseCode(codeBeforeSecondTrim)).toBe(
        normaliseCode(initialCode)
      )

      await dragBetweenRatios(page, scene, [0.6697, 0.469], [0.8689, 0.5833])

      const trimmedCode = await waitForCodeChange(page, codeBeforeSecondTrim)
      expect(normaliseCode(trimmedCode)).not.toBe(
        normaliseCode(codeBeforeSecondTrim)
      )

      await pressUndo()
      const undoneCode = await waitForCodeChange(page, trimmedCode)
      expect(normaliseCode(undoneCode)).toBe(normaliseCode(initialCode))
    })
  })

  test('can delete individual constraints and the sketch block from the feature tree', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    await test.step('Set up the app with test code', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.58mm, var 3.79mm], end = [var 6.18mm, var 5.34mm])
  horizontal(line1)
  line2 = line(start = [var 6.79mm, var 3.56mm], end = [var 6.5mm, var -2.56mm])
  coincident([line2.start, line1.end])
}`
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, code)
      await page.setBodyDimensions({ width: 1200, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch(on')
      await toolbar.openFeatureTreePane()
    })

    // TODO: figure out why this is needed for frontend's deleteObjects to work
    await test.step('Enter sketch edit mode and exit it', async () => {
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })
      const solveSketchOperation = await toolbar.getFeatureTreeOperation(
        'sketch001',
        0
      )
      await solveSketchOperation.dblclick()
      await page.waitForTimeout(1000)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await toolbar.exitSketchBtn.click()
      await page.waitForTimeout(1000)
      await expect(toolbar.startSketchBtn).toBeEnabled()
    })

    await test.step('Delete first constraint from feature tree and verify code updates', async () => {
      const caret = await toolbar.getFeatureTreeSketchBlockGroupCaret(0)
      await caret.click()
      const op = await toolbar.getFeatureTreeOperation(
        'Horizontal Constraint',
        0
      )
      await op.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('horizontal(line1)')
    })

    await test.step('Delete second constraint from feature tree and verify code updates', async () => {
      const caret = await toolbar.getFeatureTreeSketchBlockGroupCaret(0)
      await caret.click()
      const op = await toolbar.getFeatureTreeOperation(
        'Coincident Constraint',
        0
      )
      await op.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain(
        'coincident([line2.start, line1.end])'
      )
    })

    await test.step('Delete sketch block from feature tree and verify code updates', async () => {
      const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
      await op.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('sketch(on')
    })
  })

  const square = `sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.05mm, var -1.99mm], end = [var 2.1mm, var -1.99mm])
  line2 = line(start = [var 2.1mm, var -1.99mm], end = [var 2.1mm, var 2.23mm])
  line3 = line(start = [var 2.1mm, var 2.23mm], end = [var -2.05mm, var 2.23mm])
  line4 = line(start = [var -2.05mm, var 2.23mm], end = [var -2.05mm, var -1.99mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}`

  const squareInches = withDefaultLengthUnitInches(square)

  test('can extrude sketch regions', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })

    await test.step('Set up scene with a closed sketch block', async () => {
      await context.addInitScript(async (square) => {
        localStorage.setItem('persistCode', square)
      }, square)
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch001 = sketch(on = XZ) {')
    })

    await test.step('Extrude region by clicking center', async () => {
      await toolbar.extrudeButton.click()
      await clickCenter()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'sketches',
        currentArgValue: '',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '',
          Length: '5',
        },
        highlightedHeaderArg: 'Profiles',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '5',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '1 region',
          Length: '5',
        },
        highlightedHeaderArg: 'length',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '1 region',
          Length: '5',
        },
      })
      await cmdBar.submit()
    })

    await test.step('Expect extrusion', async () => {
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(
        'region(point = [0.025mm, -1.9875mm], sketch = sketch001)'
      )
      await editor.expectEditor.toContain(
        'extrude001 = extrude(region001, length = 5)'
      )
      await expect(
        page.locator('.cm-lint-marker-error').first()
      ).not.toBeInViewport()
    })

    await test.step('Delete extrude from feature tree', async () => {
      await toolbar.openFeatureTreePane()
      const extrudeOp = toolbar.featureTreePane
        .getByRole('button', { name: /^(Extrude|extrude001)$/ })
        .first()
      await expect(extrudeOp).toBeVisible()
      await extrudeOp.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('extrude(')
    })

    await test.step('Delete region from feature tree and expect original code', async () => {
      await toolbar.openFeatureTreePane()
      const regionOp = toolbar.featureTreePane
        .getByRole('button', { name: /^(Region|region001)$/ })
        .first()
      await expect(regionOp).toBeVisible()
      await regionOp.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('region(')
      await editor.expectEditor.toContain(square, { shouldNormalise: true })
    })
  })

  test('can extrude sketch regions with defaultLengthUnit = inches', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })

    await test.step('Set up scene with a closed sketch block in inches', async () => {
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, squareInches)
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('@settings(defaultLengthUnit = in')
      await editor.expectEditor.toContain('sketch001 = sketch(on = XZ) {')
    })

    await test.step('Extrude region by clicking center', async () => {
      await toolbar.extrudeButton.click()
      await clickCenter()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'sketches',
        currentArgValue: '',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '',
          Length: '5',
        },
        highlightedHeaderArg: 'Profiles',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '5',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '1 region',
          Length: '5',
        },
        highlightedHeaderArg: 'length',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '1 region',
          Length: '5',
        },
      })
      await cmdBar.submit()
    })

    await test.step('Expect extrusion uses inches for region point', async () => {
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(
        'region(point = [0.0009843in, -0.078248in], sketch = sketch001)'
      )
      await editor.expectEditor.toContain(
        'extrude001 = extrude(region001, length = 5)'
      )
      await expect(
        page.locator('.cm-lint-marker-error').first()
      ).not.toBeInViewport()
    })
  })

  test('can sketch on extrude cap', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const code = `${square}
region001 = region(point = [0.025mm, -1.9875mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)`
    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })

    await test.step('Set up the app with initial code and enable sketch solve mode', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }
      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 1000 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Start sketch and click center face', async () => {
      await toolbar.startSketchPlaneSelection()
      await clickCenter()
    })

    await test.step('Expect sketch on end cap', async () => {
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await editor.expectEditor.toContain(
        `
        face001 = faceOf(extrude001, face = END)
        sketch002 = sketch(on = face001) {
        }`,
        { shouldNormalise: true }
      )
    })
  })

  test('can sketch on extrude wall', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const code = `${square}
region001 = region(point = [0.025mm, -1.9875mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)`
    const [clickAboveCenter] = scene.makeMouseHelpers(0.5, 0.35, {
      format: 'ratio',
    })

    await test.step('Set up the app with initial code and enable sketch solve mode', async () => {
      if (tronApp) {
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }
      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 1000 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Start sketch and click top face', async () => {
      await toolbar.startSketchPlaneSelection()
      await clickAboveCenter()
    })

    await test.step('Expect sketch on wall', async () => {
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await editor.expectEditor.toContain(
        `
        face001 = faceOf(extrude001, face = region001.tags.line4)
        sketch002 = sketch(on = face001){
        }`,
        { shouldNormalise: true }
      )
    })
  })
})
