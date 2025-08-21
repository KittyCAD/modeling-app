import { KCL_DEFAULT_LENGTH } from '@src/lib/constants'
import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Testing selections', () => {
  test('parent Solid should be select and deletable and uses custom planes to position children', async ({
    page,
    homePage,
    scene,
    cmdBar,
    editor,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn(XY)
yo = startProfile(part001, at = [4.83, 12.56])
  |> line(end = [15.1, 2.48])
  |> line(end = [3.15, -9.85], tag = $seg01)
  |> line(end = [-15.17, -4.1])
  |> angledLine(angle = segAng(seg01), length = 12.35, tag = $seg02)
  |> line(end = [-13.02, 10.03])
  |> close()
yoo = extrude(yo, length = 4)
sketch002 = startSketchOn(yoo, face = seg02)
sketch001 = startSketchOn(yoo, face = 'END')
profile002 = startProfile(sketch002, at = [-11.08, 2.39])
  |> line(end = [4.89, 0.9])
  |> line(end = [-0.61, -2.41])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile002, length = 15)
profile001 = startProfile(sketch001, at = [7.49, 9.96])
  |> angledLine(angle = 0, length = 5.05, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 4.81)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const extrudeWall = { x: 575, y: 238 }

    // DELETE with selection on face of parent
    await page.mouse.click(extrudeWall.x, extrudeWall.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line(end = [-15.17, -4.1])'
    )
    await u.openAndClearDebugPanel()
    await page.keyboard.press('Delete')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)

    await editor.expectEditor.not.toContain(`yoo = extrude(yo, length = 4)`, {
      shouldNormalise: true,
    })
    await editor.expectEditor.toContain(`startSketchOn({plane={origin`, {
      shouldNormalise: true,
    })
    await editor.snapshot()
  })
  test("Extrude button should be disabled if there's no extrudable geometry when nothing is selected", async ({
    page,
    editor,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [3.29, 7.86])
    |> line(end = [2.48, 2.44])
    |> line(end = [2.66, 1.17])
    |> line(end = [3.75, 0.46])
    |> line(end = [4.99, -0.46], tag = $seg01)
    |> line(end = [3.3, -2.12])
    |> line(end = [2.16, -3.33])
    |> line(end = [0.85, -3.08])
    |> line(end = [-0.18, -3.36])
    |> line(end = [-3.86, -2.73])
    |> line(end = [-17.67, 0.85])
    |> close()
  extrude001 = extrude(sketch001, length = 10)
    `
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectUnExtrudable = async () => {
      await editor.scrollToText(`line(end = [4.99, -0.46], tag = $seg01)`)
      await page.getByText(`line(end = [4.99, -0.46], tag = $seg01)`).click()
    }
    const clickEmpty = () => page.mouse.click(700, 460)
    await selectUnExtrudable()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()

    await clickEmpty()

    // expect active line to contain nothing
    await expect(page.locator('.cm-activeLine')).toHaveText('')

    const codeToAdd = `${await u.codeLocator.allInnerTexts()}
  sketch002 = startSketchOn(extrude001, face = $seg01)
    |> startProfile(at = [-12.94, 6.6])
    |> line(end = [2.45, -0.2])
    |> line(end = [-2, -1.25])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  `
    await u.codeLocator.fill(codeToAdd)

    await selectUnExtrudable()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()

    await clickEmpty()
    await expect(page.locator('.cm-activeLine')).toHaveText('')
    // there's not extrudable geometry, so button should be enabled
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
  })

  test(
    'Testing selections (and hovers) work on sketches when NOT in sketch mode',
    { tag: '@web' },
    async ({ page, homePage, scene, cmdBar }) => {
      const cases = [
        {
          pos: [0.31, 0.5],
          expectedCode: 'line(end = [74.36, 130.4], tag = $seg01)',
        },
        {
          pos: [0.448, 0.557],
          expectedCode: 'angledLine(angle = segAng(seg01), length = yo)',
        },
        {
          pos: [0.753, 0.5],
          expectedCode: 'tangentialArc(endAbsolute = [167.95, -28.85])',
        },
      ] as const
      await page.addInitScript(
        async ({ cases }) => {
          localStorage.setItem(
            'persistCode',
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
        },
        { cases }
      )
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // end setup, now test hover and selects
      for (const { pos, expectedCode } of cases) {
        const [click, hover] = scene.makeMouseHelpers(pos[0], pos[1], {
          format: 'ratio',
          steps: 5,
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
    }
  )
  test("Various pipe expressions should and shouldn't allow edit and or extrude", async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    const selectionsSnippets = {
      extrudeAndEditBlocked: '|> startProfile(at = [10.81, 32.99])',
      extrudeAndEditBlockedInFunction: '|> startProfile(at = pos)',
      extrudeAndEditAllowed: '|> startProfile(at = [15.72, 4.7])',
      editOnly: '|> startProfile(at = [15.79, -14.6])',
    }
    await page.addInitScript(
      async ({
        extrudeAndEditBlocked,
        extrudeAndEditBlockedInFunction,
        extrudeAndEditAllowed,
        editOnly,
      }: any) => {
        localStorage.setItem(
          'persistCode',
          `part001 = startSketchOn(XZ)
  ${extrudeAndEditBlocked}
  |> line(end = [25.96, 2.93])
  |> line(end = [5.25, -5.72])
  |> line(end = [-2.01, -10.35])
  |> line(end = [-27.65, -2.78])
  |> close()
  |> extrude(length = 5)
    sketch002 = startSketchOn(XZ)
  ${extrudeAndEditAllowed}
  |> line(end = [10.32, 6.47])
  |> line(end = [9.71, -6.16])
  |> line(end = [-3.08, -9.86])
  |> line(end = [-12.02, -1.54])
  |> close()
    sketch003 = startSketchOn(XZ)
  ${editOnly}
  |> line(end = [27.55, -1.65])
  |> line(end = [4.95, -8])
  |> line(end = [-20.38, -10.12])
  |> line(end = [-15.79, 17.08])

    fn yohey(@pos) {
  sketch004 = startSketchOn(XZ)
  ${extrudeAndEditBlockedInFunction}
  |> line(end = [27.55, -1.65])
  |> line(end = [4.95, -10.53])
  |> line(end = [-20.38, -8])
  |> line(end = [-15.79, 17.08])
  return ''
    }

    yohey([15.79, -34.6])
    `
        )
      },
      selectionsSnippets
    )
    await page.setBodyDimensions({ width: 1200, height: 1000 })

    await homePage.goToModelingScene()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // wait for start sketch as a proxy for the stream being ready
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.getByText(selectionsSnippets.extrudeAndEditBlocked).click()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()

    await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeDisabled()

    await page.getByText(selectionsSnippets.editOnly).click()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeDisabled()

    await page
      .getByText(selectionsSnippets.extrudeAndEditBlockedInFunction)
      .click()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeVisible()
  })

  test('Deselecting line tool should mean nothing happens on click', async ({
    page,
    homePage,
  }) => {
    /**
     * If the line tool is clicked when the state is 'No Points' it will exit Sketch mode.
     * This is the same exact workflow as pressing ESC.
     *
     * To continue to test this workflow, we now enter sketch mode and place a single point before exiting the line tool.
     */
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await u.openDebugPanel()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // Clicks the XZ Plane in the page
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)`
    )

    await page.waitForTimeout(600)

    const firstClickCoords = { x: 650, y: 200 } as const
    // Place a point because the line tool will exit if no points are pressed
    await page.mouse.click(firstClickCoords.x, firstClickCoords.y)
    await page.waitForTimeout(600)

    // Code before exiting the tool
    let previousCodeContent = (
      await page.locator('.cm-content').innerText()
    ).replace(/\s+/g, '')

    // deselect the line tool by clicking it
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await page.mouse.click(700, 200)
    await page.waitForTimeout(100)
    await page.mouse.click(700, 250)
    await page.waitForTimeout(100)
    await page.mouse.click(750, 200)
    await page.waitForTimeout(100)

    await expect
      .poll(async () => {
        let str = await page.locator('.cm-content').innerText()
        str = str.replace(/\s+/g, '')
        return str
      })
      .toBe(previousCodeContent)

    // select line tool again
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await u.closeDebugPanel()

    // Click to continue profile
    await page.mouse.click(firstClickCoords.x, firstClickCoords.y)
    await page.waitForTimeout(100)

    // line tool should work as expected again
    await page.mouse.click(700, 200)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(100)
    await page.mouse.click(700, 300)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(100)
    await page.mouse.click(750, 300)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()
  })
})
