import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import type { IntegerIdPicker } from '@src/clientSideScene/localRenderer/IntegerIdPicker'
import type { Camera } from 'three'

const cubeDefinition = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

fn get10mmCube() {
  sketch001 = sketch(on = XY) {
    line1 = line(start = [var 0cm, var 0cm], end = [var 10mm, var 0cm])
    line2 = line(start = [var 10mm, var 0cm], end = [var 10mm, var 10mm])
    line3 = line(start = [var 10mm, var 10mm], end = [var 0cm, var 10mm])
    line4 = line(start = [var 0cm, var 10mm], end = [var 0cm, var 0cm])
    coincident([line1.end, line2.start])
    coincident([line2.end, line3.start])
    coincident([line3.end, line4.start])
    parallel([line2, line4])
    parallel([line3, line1])
    perpendicular([line1, line2])
    horizontal(line3)
    coincident([line1.start, ORIGIN])
    distance([line3.start, line3.end]) == 10mm
    distance([line2.start, line2.end]) == 10mm
  }

  hidden001 = hide(sketch001)
  region001 = region(point = [5mm, 0.0025mm], sketch = sketch001)
  extrude001 = extrude(region001, length = 10mm)

  return extrude001
}`

const twoCubes = `${cubeDefinition}
cube0 = get10mmCube()
  |> translate(x = 10, y = 0, z = 0)
cube1 = get10mmCube()`

const singleCube = `${cubeDefinition}
cube1 = get10mmCube()`

const pickIdAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    async ({ x, y }) => {
      const view = window.app.singletons.kclManager.sceneInfra.localRenderer
      if (!view) throw new Error('No local renderer')
      const camera = Reflect.get(view, 'camera') as Camera
      const gpu = Reflect.get(view, 'gpu') as {
        renderer: { domElement: HTMLCanvasElement }
        integerIdPicker: IntegerIdPicker
      }
      const rect = gpu.renderer.domElement.getBoundingClientRect()
      const result = await gpu.integerIdPicker.pick({
        x: x - rect.x,
        y: y - rect.y,
        streamWidth: rect.width,
        streamHeight: rect.height,
        camera,
      })
      return (result?.target?.userData.edgeUuid ??
        result?.target?.userData.faceUuid ??
        null) as string | null
    },
    { x, y }
  )

test.describe(
  'Local edge picker comparison',
  { tag: ['@web', '@browsers', '@localRenderer'] },
  () => {
    for (const mode of ['original-main', 'fixed-24', 'gpu-growth'] as const) {
      test(`two cubes from the top-front-right corner: ${mode}`, async ({
        page,
        homePage,
        editor,
        scene,
        toolbar,
      }, testInfo) => {
        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.goToModelingScene()
        await scene.settled()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', twoCubes)
        )
        await scene.moveCameraTo(
          { x: 44.64, y: -29.64, z: 39.64 },
          { x: 10, y: 5, z: 5 }
        )
        await scene.settled()
        await page.evaluate((mode) => {
          window.app.singletons.kclManager.sceneInfra.localRenderer?.setEdgePickingMode(
            mode
          )
        }, mode)

        const entities = await scene.getProjectedEntities()
        const topSeam = entities
          .filter((entity) => entity.kind === 'edge')
          .sort(
            (a, b) =>
              Math.hypot(a.x - 876, a.y - 343) -
              Math.hypot(b.x - 876, b.y - 343)
          )[0]
        expect(topSeam).toBeDefined()
        expect(Math.hypot(topSeam.x - 876, topSeam.y - 343)).toBeLessThan(5)
        const seamIds = entities
          .filter(
            (entity) =>
              entity.kind === 'edge' &&
              Math.hypot(entity.x - topSeam.x, entity.y - topSeam.y) < 5
          )
          .map((entity) => entity.id)
        await testInfo.attach('two-cubes-top-front-right', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
        await testInfo.attach('projected-entities', {
          body: JSON.stringify(entities, null, 2),
          contentType: 'application/json',
        })

        const bounds = await scene.streamWrapper.boundingBox()
        if (!bounds) throw new Error('No stream to click')
        const clickAt = (x: number, y: number) =>
          scene.makeMouseHelpers(
            (x - bounds.x) / bounds.width,
            (y - bounds.y) / bounds.height,
            { format: 'ratio' }
          )[0]
        const above = { x: topSeam.x - 1.5, y: topSeam.y - 2.6 }
        const clickAbove = clickAt(above.x, above.y)
        await clickAbove()
        await toolbar.expectSelection('1 edge')
        expect(seamIds).toContain(await pickIdAt(page, above.x, above.y))

        const clickEmpty = scene.makeMouseHelpers(0.9, 0.85, {
          format: 'ratio',
        })[0]
        await clickEmpty()
        await toolbar.expectSelection('No selection')

        const below = { x: topSeam.x + 1.5, y: topSeam.y + 2.6 }
        const clickBelow = clickAt(below.x, below.y)
        await clickBelow()
        if (mode === 'original-main' || mode === 'fixed-24') {
          test.fail(true, `${mode} selects the adjacent face below the seam`)
        }
        await toolbar.expectSelection('1 edge')
        expect(seamIds).toContain(await pickIdAt(page, below.x, below.y))
      })
    }

    for (const mode of ['fixed-24', 'depth-offset', 'gpu-growth'] as const) {
      test(`right cube front corner: ${mode}`, async ({
        page,
        homePage,
        editor,
        scene,
        toolbar,
      }, testInfo) => {
        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.goToModelingScene()
        await scene.settled()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', twoCubes)
        )
        await scene.moveCameraTo(
          { x: 44.64, y: -29.64, z: 39.64 },
          { x: 10, y: 5, z: 5 }
        )
        await scene.settled()
        await page.evaluate((mode) => {
          window.app.singletons.kclManager.sceneInfra.localRenderer?.setEdgePickingMode(
            mode
          )
        }, mode)

        const entities = await scene.getProjectedEntities()
        const vertical = entities
          .filter((entity) => entity.kind === 'edge')
          .sort(
            (a, b) =>
              Math.hypot(a.x - 928, a.y - 494) -
              Math.hypot(b.x - 928, b.y - 494)
          )[0]
        expect(Math.hypot(vertical.x - 928, vertical.y - 494)).toBeLessThan(5)
        const corner = { x: vertical.x, y: vertical.y - 61 }
        const point = { x: corner.x + 2, y: corner.y + 3 }
        const bounds = await scene.streamWrapper.boundingBox()
        if (!bounds) throw new Error('No stream to click')
        const [clickCorner] = scene.makeMouseHelpers(
          (point.x - bounds.x) / bounds.width,
          (point.y - bounds.y) / bounds.height,
          { format: 'ratio', debugLabel: 'corner pick' }
        )
        await clickCorner()
        await toolbar.expectSelection('1 edge')
        await testInfo.attach('corner-pick', {
          body: JSON.stringify({
            vertical: vertical.id,
            point,
            picked: await pickIdAt(page, point.x, point.y),
          }),
          contentType: 'application/json',
        })
        await testInfo.attach('corner-scene', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
        if (mode === 'depth-offset' || mode === 'fixed-24') {
          test.fail(true, `${mode} chooses the front-face edge`)
        }
        expect(await pickIdAt(page, point.x, point.y)).toBe(vertical.id)
      })
    }

    for (const mode of ['fixed-24', 'depth-offset', 'gpu-growth'] as const) {
      test(`hidden back edge near the right cube silhouette: ${mode}`, async ({
        page,
        homePage,
        editor,
        scene,
        toolbar,
      }, testInfo) => {
        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.goToModelingScene()
        await scene.settled()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', twoCubes)
        )
        await scene.moveCameraTo(
          { x: 44.64, y: -29.64, z: 39.64 },
          { x: 10, y: 5, z: 5 }
        )
        await scene.settled()
        const entities = await scene.getProjectedEntities()
        await page.evaluate((mode) => {
          window.app.singletons.kclManager.sceneInfra.localRenderer?.setEdgePickingMode(
            mode
          )
        }, mode)
        const hidden = entities.find(
          (edge) =>
            edge.kind === 'edge' &&
            !edge.visible &&
            Math.hypot(edge.x - 980, edge.y - 463) < 5
        )
        const visible = entities.find(
          (edge) =>
            edge.kind === 'edge' &&
            edge.visible &&
            Math.hypot(edge.x - 980, edge.y - 524) < 5
        )
        if (!hidden || !visible) {
          throw new Error('Expected the hidden and visible right-cube edges')
        }
        const point = { x: 1035.5, y: 494.5 }
        const bounds = await scene.streamWrapper.boundingBox()
        if (!bounds) throw new Error('No stream to click')
        const [click] = scene.makeMouseHelpers(
          (point.x - bounds.x) / bounds.width,
          (point.y - bounds.y) / bounds.height,
          { format: 'ratio', debugLabel: 'hidden edge pick' }
        )
        await click()
        await toolbar.expectSelection('1 edge')
        await testInfo.attach('hidden-edge-pick', {
          body: JSON.stringify({
            hidden: hidden.id,
            visible: visible.id,
            picked: await pickIdAt(page, point.x, point.y),
          }),
          contentType: 'application/json',
        })
        if (mode === 'depth-offset' || mode === 'fixed-24') {
          test.fail(true, `${mode} picks the hidden back edge`)
        }
        expect(await pickIdAt(page, point.x, point.y)).toBe(visible.id)
      })
    }

    for (const mode of ['original-main', 'fixed-24', 'gpu-growth'] as const) {
      test(`single cube face at 240mm: ${mode}`, async ({
        page,
        homePage,
        editor,
        scene,
        toolbar,
      }, testInfo) => {
        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.goToModelingScene()
        await scene.settled()
        await scene.waitForExecutionDoneAfter(() =>
          editor.replaceCode('', singleCube)
        )
        const offset = 240 / Math.sqrt(3)
        await scene.moveCameraTo(
          { x: 5 + offset, y: 5 - offset, z: 5 + offset },
          { x: 5, y: 5, z: 5 }
        )
        await scene.settled()
        await page.evaluate(() => {
          window.app.singletons.kclManager.sceneInfra.localRenderer?.setEdgePickingMode(
            'original-main'
          )
        })
        const face = await page.evaluate(async () => {
          const view = window.app.singletons.kclManager.sceneInfra.localRenderer
          return (await view?.getPickableModelFacePoint()) ?? null
        })
        if (!face) throw new Error('Original main has no pickable cube face')
        await page.evaluate((mode) => {
          window.app.singletons.kclManager.sceneInfra.localRenderer?.setEdgePickingMode(
            mode
          )
        }, mode)
        const anyFace = await page.evaluate(async () => {
          const view = window.app.singletons.kclManager.sceneInfra.localRenderer
          return (await view?.getPickableModelFacePoint()) ?? null
        })
        await testInfo.attach('far-zoom-face', {
          body: JSON.stringify({
            face,
            anyFace,
            picked: await pickIdAt(page, face.x, face.y),
          }),
          contentType: 'application/json',
        })
        const bounds = await scene.streamWrapper.boundingBox()
        if (!bounds) throw new Error('No stream to click')
        const [clickFace] = scene.makeMouseHelpers(
          (face.x - bounds.x) / bounds.width,
          (face.y - bounds.y) / bounds.height,
          { format: 'ratio', debugLabel: 'far-zoom face' }
        )
        await clickFace()
        await testInfo.attach('far-zoom-cube', {
          body: await page.screenshot(),
          contentType: 'image/png',
        })
        if (mode === 'gpu-growth' || mode === 'fixed-24') {
          test.fail(true, `${mode} covers the cube face at this point`)
        }
        await toolbar.expectSelection('1 face')
        expect(await pickIdAt(page, face.x, face.y)).toBe(face.id)
        expect(anyFace).not.toBeNull()
      })
    }
  }
)
