import { expect, test } from '@e2e/playwright/zoo-test'

const legacy = `@settings(kclVersion = 1.0)
profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 0])
  |> line(end = [0, 5])
  |> line(end = [-5, 0])
  |> close()
copies = patternLinear2d(profile001, instances = 3, distance = 8, axis = [1, 0])`

test('selects individual legacy pattern profiles @localRenderer @web', async ({
  page,
  homePage,
  scene,
  editor,
}) => {
  await page.setBodyDimensions({ width: 1200, height: 800 })
  await homePage.goToModelingScene()
  await scene.settled()
  await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', legacy))
  await expect
    .poll(() =>
      page.evaluate(() => window.app.singletons.kclManager.diagnostics)
    )
    .toEqual([])
  await editor.closePane()
  await scene.moveCameraTo({ x: 10, y: 2.5, z: 50 }, { x: 10, y: 2.5, z: 0 })
  const copyFaces = await page.evaluate(() => {
    const pattern = [
      ...window.app.singletons.kclManager.artifactGraph.values(),
    ].find((a) => a.type === 'pattern')
    if (pattern?.type !== 'pattern') throw new Error('Expected a pattern')
    return pattern.copyFaceIds
  })
  expect(copyFaces).toHaveLength(2)
  for (const [index, faceId] of copyFaces.entries()) {
    const [clickCopy] = await scene.findFace(index + 1, { visible: true })
    await clickCopy()
    await expect
      .poll(() =>
        page.evaluate(async () =>
          window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'select_get' },
          })
        )
      )
      .toMatchObject({
        resp: {
          data: { modeling_response: { data: { entity_ids: [faceId] } } },
        },
      })
  }
})
