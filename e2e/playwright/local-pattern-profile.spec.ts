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

for (const version of ['2.0', '3.0-preview']) {
  test(`selects patterned sketch-block profiles ${version} @localRenderer @web`, async ({
    page,
    homePage,
    scene,
    editor,
  }) => {
    const code = `@settings(kclVersion = "${version}")
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 2.5mm], center = [var 2.5mm, var 2.5mm])
}
${version === '2.0' ? '' : 'region001 = region(segments = [sketch001.circle1])'}
copies = patternLinear2d(${version === '2.0' ? 'sketch001' : 'region001'}, instances = 3, distance = 8, axis = [1, 0])`
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await editor.closePane()
    await scene.moveCameraTo({ x: 10, y: 2.5, z: 50 }, { x: 10, y: 2.5, z: 0 })
    for (const copyIndex of [0, 1]) {
      const target = await page.evaluate(async (copyIndex) => {
        const manager = window.app.singletons.kclManager
        const pattern = [...manager.artifactGraph.values()].find(
          (a) => a.type === 'pattern'
        )
        if (pattern?.type !== 'pattern' || !manager.sceneInfra.localRenderer)
          throw new Error('Expected a local pattern')
        const faces = (
          await manager.sceneInfra.localRenderer.getProjectedEntities()
        ).filter((e) => e.kind === 'face' && e.visible)
        for (const [index, face] of faces.entries()) {
          const result = await window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'query_entity_type', entity_id: face.id },
          })
          if (!result || !('resp' in result) || result.resp.type !== 'modeling')
            continue
          const response = result.resp.data.modeling_response
          if (response.type !== 'query_entity_type') continue
          const ref = response.data.reference
          if (
            ref?.type === 'region' &&
            ref.topology_fallback?.parent_id === pattern.copyIds[copyIndex]
          )
            return { index, id: face.id }
        }
        throw new Error('Expected the copied region to be visible')
      }, copyIndex)
      const [clickCopy] = await scene.findFace(target.index, { visible: true })
      await clickCopy()
      await expect(page.getByTestId('selection-status')).toContainText(
        '1 region'
      )
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
            data: { modeling_response: { data: { entity_ids: [target.id] } } },
          },
        })
    }
  })
}
