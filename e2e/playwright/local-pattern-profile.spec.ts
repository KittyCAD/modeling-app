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

for (const arrayInput of [false, true]) {
  test(`extrudes one legacy copy (array: ${arrayInput}) @localRenderer @web`, async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const secondProfile = legacy
      .slice(legacy.indexOf('profile001 ='), legacy.indexOf('copies ='))
      .replace('profile001', 'profile002')
      .replace('[0, 0]', '[0, 10]')
    const code = arrayInput
      ? legacy
          .replace('copies =', secondProfile + 'copies =')
          .replace(
            'patternLinear2d(profile001,',
            'patternLinear2d([profile001, profile002],'
          )
      : legacy
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await editor.closePane()
    await scene.moveCameraTo({ x: 10, y: 7.5, z: 65 }, { x: 10, y: 7.5, z: 0 })
    const index = await page.evaluate(
      async (inputIndex) => {
        const manager = window.app.singletons.kclManager
        const pattern = [...manager.artifactGraph.values()].filter(
          (a) => a.type === 'pattern'
        )[inputIndex]
        if (pattern?.type !== 'pattern' || !manager.sceneInfra.localRenderer)
          throw new Error('Expected pattern')
        const faces = (
          await manager.sceneInfra.localRenderer.getProjectedEntities()
        ).filter((e) => e.kind === 'face' && e.visible)
        return faces.findIndex((f) => f.id === pattern.copyFaceIds[0])
      },
      arrayInput ? 1 : 0
    )
    expect(index).toBeGreaterThanOrEqual(0)
    const [click] = await scene.findFace(index, { visible: true })
    await click()
    await toolbar.extrudeButton.click()
    await expect(modelingDialog.submitButton).toBeEnabled()
    await modelingDialog.submit()
    await scene.settled()
    await editor.expectEditor.toContain(
      `extrude(copies[${arrayInput ? 4 : 1}], length = 5)`
    )
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...window.app.singletons.kclManager.artifactGraph.values()].filter(
              (a) => a.type === 'sweep'
            ).length
        )
      )
      .toBe(1)
    await expect
      .poll(() =>
        page.evaluate(() => window.app.singletons.kclManager.diagnostics)
      )
      .toEqual([])
  })
}

const regionCases = [
  {
    name: 'KCL 3.0',
    version: '3.0-preview',
    extraCircle: '',
    regions: 'region001 = region(segments = [sketch001.circle1])',
    input: 'region001',
    inputIndex: 0,
    hideSource: false,
  },
  {
    name: 'KCL 3.0 array input',
    version: '3.0-preview',
    extraCircle:
      '  circle2 = circle(start = [var 5mm, var 12.5mm], center = [var 2.5mm, var 12.5mm])',
    regions:
      'region001 = region(segments = [sketch001.circle1])\nregion002 = region(segments = [sketch001.circle2])',
    input: '[region001, region002]',
    inputIndex: 1,
    hideSource: false,
  },
]

for (const fixture of regionCases) {
  test(`extrudes individual patterned regions ${fixture.name} @localRenderer @web`, async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const code = `@settings(kclVersion = "${fixture.version}")
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 2.5mm], center = [var 2.5mm, var 2.5mm])
${fixture.extraCircle}
}
${fixture.regions}
copies = patternLinear2d(${fixture.input}, instances = 3, distance = 8mm, axis = [1, 0])
${fixture.hideSource ? 'hidden001 = hide(sketch001)' : ''}`
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await editor.closePane()
    await scene.moveCameraTo({ x: 10, y: 2.5, z: 50 }, { x: 10, y: 2.5, z: 0 })
    for (const copyIndex of [0, 1]) {
      if (copyIndex > 0) {
        await editor.openPane()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', code)
        )
        await editor.closePane()
        await scene.moveCameraTo(
          { x: 10, y: 2.5, z: 50 },
          { x: 10, y: 2.5, z: 0 }
        )
      }
      const target = await page.evaluate(
        async ({ copyIndex, inputIndex }) => {
          const manager = window.app.singletons.kclManager
          const pattern = [...manager.artifactGraph.values()].filter(
            (a) => a.type === 'pattern'
          )[inputIndex]
          if (pattern?.type !== 'pattern' || !manager.sceneInfra.localRenderer)
            throw new Error('Expected a local pattern')
          const faces = (
            await manager.sceneInfra.localRenderer.getProjectedEntities()
          ).filter((e) => e.kind === 'face' && e.visible)
          const references = []
          for (const [index, face] of faces.entries()) {
            const result = await window.engineCommandManager.sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: crypto.randomUUID(),
              cmd: { type: 'query_entity_type', entity_id: face.id },
            })
            if (
              !result ||
              !('resp' in result) ||
              result.resp.type !== 'modeling'
            )
              continue
            const response = result.resp.data.modeling_response
            if (response.type !== 'query_entity_type') continue
            const ref = response.data.reference
            references.push(ref)
            if (
              ref?.type === 'region' &&
              ref.topology_fallback?.parent_id === pattern.copyIds[copyIndex]
            ) {
              return { index, id: face.id }
            }
          }
          throw new Error(
            `Expected the copied region to be visible: ${JSON.stringify({ copies: pattern.copyIds, references })}`
          )
        },
        {
          copyIndex,
          inputIndex: fixture.inputIndex,
        }
      )
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
      await toolbar.extrudeButton.click()
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
      const outputIndex = fixture.inputIndex * 3 + copyIndex + 1
      await editor.expectEditor.toContain(
        `extrude(copies[${outputIndex}], length = 5)`
      )
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              [
                ...window.app.singletons.kclManager.artifactGraph.values(),
              ].filter((artifact) => artifact.type === 'sweep').length
          )
        )
        .toBeGreaterThan(0)
      await expect
        .poll(() =>
          page.evaluate(() => window.app.singletons.kclManager.diagnostics)
        )
        .toEqual([])
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
      await editor.closePane()
    }
  })
}
