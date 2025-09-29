import { expect, test } from '@e2e/playwright/zoo-test'

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
  test('bad edit prompt', async ({
    context,
    homePage,
    cmdBar,
    toolbar,
    page,
    scene,
  }) => {
    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await toolbar.closePane('code')
    await toolbar.openPane('text-to-cad')

    await test.step('fire of bad prompt', async () => {
      await page
        .getByTestId('ml-ephant-conversation-input')
        .fill('ansheusha asnthuatshoeuhtaoetuhthaeu laughs in dvorak')
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
    })
    await test.step('check fail appeared', async () => {
      await expect(page.getByTestId('thinking-immediate')).not.toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByTestId('prompt-card-status-failed')).toBeVisible({
        timeout: 30_000,
      })
    })
  })
})
