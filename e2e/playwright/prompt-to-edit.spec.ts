import { expect, test } from '@e2e/playwright/zoo-test'
import * as fsp from 'fs/promises'
import * as path from 'path'

/* eslint-disable jest/no-conditional-expect */

const file = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [57.81, 250.51])
  |> line(end = [121.13, 56.63], tag = $seg02)
  |> line(end = [83.37, -34.61], tag = $seg01)
  |> line(end = [19.66, -116.4])
  |> line(end = [-221.8, -41.69])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 200)
sketch002 = startSketchOn(XZ)
  |> startProfile(at = [-114, 85.52])
  |> xLine(length = 265.36)
  |> line(end = [33.17, -261.22])
  |> xLine(length = -297.25)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = 50)
sketch003 = startSketchOn(XY)
  |> startProfile(at = [52.92, 157.81])
  |> angledLine(angle = 0, length = 176.4, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 53.4, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude003 = extrude(sketch003, length = 20)
`

test.describe('Prompt-to-edit tests', () => {
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
        await context.folderSetupFn(async (dir) => {
          const projectDir = path.join(dir, 'test-project')
          await fsp.mkdir(projectDir, { recursive: true })
          await fsp.writeFile(path.join(projectDir, 'main.kcl'), file)
        })
        await homePage.openProject('test-project')
        await scene.settled(cmdBar)

        const body1CapCoords = { x: 571, y: 311 }
        const [clickBody1Cap] = scene.makeMouseHelpers(
          body1CapCoords.x,
          body1CapCoords.y
        )
        const yellow: [number, number, number] = [179, 179, 131]
        const submittingToast = page.getByText(
          'Submitting to Text-to-CAD API...'
        )
        const successToast = page.getByText('Prompt to edit successful')
        const acceptBtn = page.getByRole('button', {
          name: 'checkmark Accept',
        })
        const rejectBtn = page.getByRole('button', { name: 'close Reject' })

        await test.step('wait for scene to load select body and check selection came through', async () => {
          await scene.expectPixelColor([134, 134, 134], body1CapCoords, 15)
          await clickBody1Cap()
          await scene.expectPixelColor(yellow, body1CapCoords, 20)
          await editor.expectState({
            highlightedCode: '',
            activeLines: ['|>startProfile(at=[-114,85.52])'],
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
          await expect(submittingToast).not.toBeVisible({
            timeout: 2 * 60_000,
          }) // can take a while
          await expect(successToast).toBeVisible()
        })

        await test.step('verify initial change', async () => {
          await editor.expectEditor.toContain('appearance(')
        })

        if (!shouldReject) {
          await test.step('check accept works', async () => {
            await acceptBtn.click()
            await expect(successToast).not.toBeVisible()

            await editor.expectEditor.toContain('appearance(')
          })
        } else {
          await test.step('check reject works', async () => {
            await rejectBtn.click()
            await expect(successToast).not.toBeVisible()

            await editor.expectEditor.not.toContain('appearance(')
          })
        }
      })
    }
  })

  test('bad edit prompt', async ({
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
    await scene.settled(cmdBar)

    const body1CapCoords = { x: 571, y: 311 }
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
        activeLines: ['|>startProfile(at=[-114,85.52])'],
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

  test(`manual code selection rename`, async ({
    context,
    homePage,
    cmdBar,
    editor,
    page,
    scene,
  }) => {
    const body1CapCoords = { x: 571, y: 311 }

    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const submittingToast = page.getByText('Submitting to Text-to-CAD API...')
    const successToast = page.getByText('Prompt to edit successful')
    const acceptBtn = page.getByRole('button', { name: 'checkmark Accept' })

    await test.step('wait for scene to load and select code in editor', async () => {
      // Find and select the text "sketch002" in the editor
      await editor.selectText('sketch002')

      // Verify the selection was made
      await editor.expectState({
        highlightedCode: '',
        activeLines: ['sketch002 = startSketchOn(XZ)'],
        diagnostics: [],
      })
    })

    await test.step('fire off edit prompt', async () => {
      await scene.expectPixelColor([134, 134, 134], body1CapCoords, 15)
      await cmdBar.openCmdBar('promptToEdit')
      await page
        .getByTestId('cmd-bar-arg-value')
        .fill('Please rename to mySketch001')
      await page.waitForTimeout(100)
      await cmdBar.progressCmdBar()
      await expect(submittingToast).toBeVisible()
      await expect(submittingToast).not.toBeVisible({
        timeout: 2 * 60_000,
      })
      await expect(successToast).toBeVisible()
    })

    await test.step('verify rename change and accept it', async () => {
      await editor.expectEditor.toContain('mySketch001 = startSketchOn')
      await editor.expectEditor.not.toContain('sketch002 = startSketchOn')
      await editor.expectEditor.toContain(
        'extrude002 = extrude(mySketch001, length = 50)'
      )

      await acceptBtn.click()
      await expect(successToast).not.toBeVisible()
    })
  })

  test('multiple body selections', async ({
    context,
    homePage,
    cmdBar,
    editor,
    page,
    scene,
  }) => {
    const body1CapCoords = { x: 571, y: 311 }
    const body2WallCoords = { x: 620, y: 152 }
    const [clickBody1Cap] = scene.makeMouseHelpers(
      body1CapCoords.x,
      body1CapCoords.y
    )
    const [clickBody2Cap] = scene.makeMouseHelpers(
      body2WallCoords.x,
      body2WallCoords.y
    )
    const grey: [number, number, number] = [132, 132, 132]

    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const submittingToast = page.getByText('Submitting to Text-to-CAD API...')
    const successToast = page.getByText('Prompt to edit successful')
    const acceptBtn = page.getByRole('button', { name: 'checkmark Accept' })

    await test.step('select multiple bodies and fire prompt', async () => {
      // Initial color check
      await scene.expectPixelColor(grey, body1CapCoords, 15)

      // Open command bar first (without selection)
      await cmdBar.openCmdBar('promptToEdit')

      // Select first body
      await page.waitForTimeout(100)
      await clickBody1Cap()

      // Hold shift and select second body
      await editor.expectState({
        highlightedCode: '',
        activeLines: ['|>startProfile(at=[-114,85.52])'],
        diagnostics: [],
      })
      await page.keyboard.down('Shift')
      await page.waitForTimeout(100)
      await clickBody2Cap()
      await editor.expectState({
        highlightedCode:
          'line(end=[121.13,56.63],tag=$seg02)extrude(profile001,length=200)',
        activeLines: [
          '|>line(end=[121.13,56.63],tag=$seg02)',
          '|>startProfile(at=[-114,85.52])',
        ],
        diagnostics: [],
      })
      await page.keyboard.up('Shift')
      await page.waitForTimeout(100)
      await cmdBar.progressCmdBar()

      // Enter prompt and submit
      await page
        .getByTestId('cmd-bar-arg-value')
        .fill('make these neon green please, use #39FF14')
      await page.waitForTimeout(100)
      await cmdBar.progressCmdBar()

      // Wait for API response
      await expect(submittingToast).toBeVisible()
      await expect(submittingToast).not.toBeVisible({
        timeout: 2 * 60_000,
      })
      await expect(successToast).toBeVisible()
    })

    await test.step('verify code changed', async () => {
      await editor.expectEditor.toContain('appearance(')

      // Accept changes
      await acceptBtn.click()
      await expect(successToast).not.toBeVisible()
    })
  })
})
