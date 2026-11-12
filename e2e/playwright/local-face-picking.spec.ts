import { expect, test } from '@e2e/playwright/zoo-test'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import { isArray } from '@src/lib/utils'

// The nose from the snowman sample. Standard tessellation emits primitives for
// B-rep faces 1 through 4. Faces 0 and 5 have no triangles.
const nose = `@settings(defaultLengthUnit = mm, kclVersion = "3.0-preview")
noseSketch = sketch(on = XZ) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 18mm, var 0mm])
  line2 = line(start = [var 18mm, var 0mm], end = [var 18mm, var -0.01mm])
  coincident([line1.end, line2.start])
  arc3 = arc(start = [var 17.54mm, var -0.51mm], end = [var 18mm, var -0.01mm], center = [var 17.5mm, var -0.01mm])
  coincident([line2.end, arc3.end])
  slope = line(start = [var 17.54mm, var -0.51mm], end = [var 1.34mm, var -1.93mm])
  coincident([arc3.start, slope.start])
  arc5 = arc(start = [var 0mm, var -0.5mm], end = [var 1.34mm, var -1.93mm], center = [var 1.23mm, var -0.68mm])
  coincident([slope.end, arc5.end])
  line6 = line(start = [var 0mm, var -0.5mm], end = [var 0mm, var 0mm])
  coincident([arc5.start, line6.start])
  horizontal(line2)
}
region001 = region(segments = [noseSketch.line1, noseSketch.line2])
hide(noseSketch)
nose = revolve(region001, axis = X)`

test(
  'picks the revolved slope after a zero-triangle face',
  {
    tag: ['@web', '@localRenderer'],
  },
  async ({ page, homePage, scene, editor }) => {
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', nose))
    const session = await page.evaluate(() => {
      const connection = window.engineCommandManager.connection
      if (!connection?.websocket || !connection.apiCallId) {
        throw new Error('The browser has no live modeling session')
      }
      const url = new URL(connection.websocket.url)
      return {
        host: url.host,
        pool: url.searchParams.get('pool'),
        geometryOnly: url.searchParams.get('geometry_only'),
        apiCallId: connection.apiCallId,
      }
    })
    console.log('Modeling session', session)
    expect(session).toMatchObject({
      host: 'api.dev.zoo.dev',
      pool: 'pr-5491-cpu',
      geometryOnly: 'true',
    })
    // The API honors explicit preview pools only for employee accounts.
    const identity = await page.request.get('https://api.dev.zoo.dev/user', {
      headers: { Authorization: `Bearer ${process.env.VITE_ZOO_API_TOKEN}` },
    })
    expect(identity.status()).toBe(200)
    const { email } = await identity.json()
    expect(typeof email === 'string' && /@(zoo\.dev|kittycad\.io)$/i.test(email)).toBe(true)
    await editor.closePane()

    // The artifact graph identifies the wall made by revolving the slope.
    // Its identity is independent of mesh ordering and of the GPU pick.
    const slopeFace = await page.evaluate(
      (offset) => {
        const artifacts = [
          ...window.app.singletons.kclManager.artifactGraph.values(),
        ]
        const original = artifacts.find(
          (a) =>
            a.type === 'segment' &&
            a.codeRef.range[0] <= offset &&
            offset < a.codeRef.range[1]
        )
        const segment = artifacts.find(
          (a) =>
            a.type === 'segment' && original && a.originalSegId === original.id
        )
        if (segment?.type !== 'segment' || !segment.surfaceId) {
          throw new Error('No revolved face for the sloped profile segment')
        }
        return segment.surfaceId
      },
      nose.indexOf('line(', nose.indexOf('slope =')) + 1
    )

    // At x=9 mm the only surface is the middle of the tapered wall.
    await scene.moveCameraTo({ x: 9, y: -12, z: 8 }, { x: 9, y: 0, z: 0 })
    const [clickSlope] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
    await clickSlope()
    await expect
      .poll(async () => {
        const result = await page.evaluate(() =>
          window.engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: crypto.randomUUID(),
            cmd: { type: 'select_get' },
          })
        )
        const msg = isArray(result) ? result[0] : result
        if (!msg || !isModelingResponse(msg)) {
          return []
        }
        const response = msg.resp.data.modeling_response
        return response.type === 'select_get' ? response.data.entity_ids : []
      })
      .toEqual([slopeFace])
  }
)
