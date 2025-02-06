import { test, expect } from './zoo-test'

/* eslint-disable jest/no-conditional-expect */

const file = `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([57.81, 250.51], sketch001)
  |> line(end = [121.13, 56.63], tag = $seg02)
  |> line(end = [83.37, -34.61], tag = $seg01)
  |> line(end = [19.66, -116.4])
  |> line(end = [-221.8, -41.69])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 200)
sketch002 = startSketchOn('XZ')
  |> startProfileAt([-73.64, -42.89], %)
  |> xLine(173.71, %)
  |> line(end = [-22.12, -94.4])
  |> xLine(-156.98, %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = 50)
sketch003 = startSketchOn('XY')
  |> startProfileAt([52.92, 157.81], %)
  |> angledLine([0, 176.4], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       53.4
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude003 = extrude(sketch003, length = 20)
`

test.describe('Prompt-to-edit tests', { tag: '@skipWin' }, () => {
  test.describe('Check the happy path, for basic changing color', () => {
    const cases = [
      {
        desc: 'User accepts change',
        shouldReject: false,
      },
      {
        desc: 'User rejects change',
        shouldReject: true,
      },
    ] as const
    for (const { desc, shouldReject } of cases) {
      test(`${desc}`, async ({
        context,
        homePage,
        cmdBar,
        editor,
        page,
        scene,
      }) => {
        await context.addInitScript((file) => {
          localStorage.setItem('persistCode', file)
        }, file)
        await homePage.goToModelingScene()

        const body1CapCoords = { x: 571, y: 351 }
        const greenCheckCoords = { x: 565, y: 345 }
        const body2WallCoords = { x: 609, y: 153 }
        const [clickBody1Cap] = scene.makeMouseHelpers(
          body1CapCoords.x,
          body1CapCoords.y
        )
        const yellow: [number, number, number] = [179, 179, 131]
        const green: [number, number, number] = [108, 152, 75]
        const notGreen: [number, number, number] = [132, 132, 132]
        const body2NotGreen: [number, number, number] = [88, 88, 88]
        const submittingToast = page.getByText(
          'Submitting to Text-to-CAD API...'
        )
        const successToast = page.getByText('Prompt to edit successful')
        const acceptBtn = page.getByRole('button', { name: 'checkmark Accept' })
        const rejectBtn = page.getByRole('button', { name: 'close Reject' })

        await test.step('wait for scene to load select body and check selection came through', async () => {
          await scene.expectPixelColor([134, 134, 134], body1CapCoords, 15)
          await clickBody1Cap()
          await scene.expectPixelColor(yellow, body1CapCoords, 20)
          await editor.expectState({
            highlightedCode: '',
            activeLines: ['|>startProfileAt([-73.64,-42.89],%)'],
            diagnostics: [],
          })
        })

        await test.step('fire off edit prompt', async () => {
          await cmdBar.openCmdBar('promptToEdit')
          // being specific about the color with a hex means asserting pixel color is more stable
          await page
            .getByTestId('cmd-bar-arg-value')
            .fill('make this neon green please, use #39FF14')
          await page.waitForTimeout(100)
          await cmdBar.progressCmdBar()
          await expect(submittingToast).toBeVisible()
          await expect(submittingToast).not.toBeVisible({ timeout: 2 * 60_000 }) // can take a while
          await expect(successToast).toBeVisible()
        })

        await test.step('verify initial change', async () => {
          await scene.expectPixelColor(green, greenCheckCoords, 15)
          await scene.expectPixelColor(body2NotGreen, body2WallCoords, 15)
          await editor.expectEditor.toContain('appearance({')
        })

        if (!shouldReject) {
          await test.step('check accept works and can be "undo"ed', async () => {
            await acceptBtn.click()
            await expect(successToast).not.toBeVisible()

            await scene.expectPixelColor(green, greenCheckCoords, 15)
            await editor.expectEditor.toContain('appearance({')

            // ctrl-z works after accepting
            await page.keyboard.down('ControlOrMeta')
            await page.keyboard.press('KeyZ')
            await page.keyboard.up('ControlOrMeta')
            await editor.expectEditor.not.toContain('appearance({')
            await scene.expectPixelColor(notGreen, greenCheckCoords, 15)
          })
        } else {
          await test.step('check reject works', async () => {
            await rejectBtn.click()
            await expect(successToast).not.toBeVisible()

            await scene.expectPixelColor(notGreen, greenCheckCoords, 15)
            await editor.expectEditor.not.toContain('appearance({')
          })
        }
      })
    }
  })

  test(`bad edit prompt`, async ({
    context,
    homePage,
    cmdBar,
    editor,
    toolbar,
    page,
    scene,
  }) => {
    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)
    await homePage.goToModelingScene()

    const body1CapCoords = { x: 571, y: 351 }
    const [clickBody1Cap] = scene.makeMouseHelpers(
      body1CapCoords.x,
      body1CapCoords.y
    )
    const yellow: [number, number, number] = [179, 179, 131]
    const submittingToast = page.getByText('Submitting to Text-to-CAD API...')
    const failToast = page.getByText(
      'Failed to edit your KCL code, please try again with a different prompt or selection'
    )

    await test.step('wait for scene to load and select body', async () => {
      await scene.expectPixelColor([134, 134, 134], body1CapCoords, 15)

      await clickBody1Cap()
      await scene.expectPixelColor(yellow, body1CapCoords, 20)

      await editor.expectState({
        highlightedCode: '',
        activeLines: ['|>startProfileAt([-73.64,-42.89],%)'],
        diagnostics: [],
      })
    })

    await test.step('fire of bad prompt', async () => {
      await cmdBar.openCmdBar('promptToEdit')
      await page
        .getByTestId('cmd-bar-arg-value')
        .fill('ansheusha asnthuatshoeuhtaoetuhthaeu laughs in dvorak')
      await page.waitForTimeout(100)
      await cmdBar.progressCmdBar()
      await expect(submittingToast).toBeVisible()
    })
    await test.step('check fail toast appeared', async () => {
      await expect(submittingToast).not.toBeVisible({ timeout: 2 * 60_000 }) // can take a while
      await expect(failToast).toBeVisible()
    })
  })
})
