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
  'Local edge picking regressions',
  { tag: ['@web', '@browsers', '@localRenderer'] },
  () => {
    test('picks the shared top edge from above and below', async ({
      page,
      homePage,
      editor,
      scene,
      toolbar,
    }) => {
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
      const topSeam = entities
        .filter((entity) => entity.kind === 'edge')
        .sort(
          (a, b) =>
            Math.hypot(a.x - 876, a.y - 343) - Math.hypot(b.x - 876, b.y - 343)
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
      const bounds = await scene.streamWrapper.boundingBox()
      if (!bounds) throw new Error('No stream to click')
      const clickAt = (x: number, y: number) =>
        scene.makeMouseHelpers(
          (x - bounds.x) / bounds.width,
          (y - bounds.y) / bounds.height,
          { format: 'ratio' }
        )[0]

      const above = { x: topSeam.x - 1.5, y: topSeam.y - 2.6 }
      await clickAt(above.x, above.y)()
      await toolbar.expectSelection('1 edge')
      expect(seamIds).toContain(await pickIdAt(page, above.x, above.y))

      const clickEmpty = scene.makeMouseHelpers(0.9, 0.85, {
        format: 'ratio',
      })[0]
      await clickEmpty()
      await toolbar.expectSelection('No selection')

      const below = { x: topSeam.x + 1.5, y: topSeam.y + 2.6 }
      await clickAt(below.x, below.y)()
      await toolbar.expectSelection('1 edge')
      expect(seamIds).toContain(await pickIdAt(page, below.x, below.y))
    })

    test('keeps a nearby edge pickable when camera focus is far behind it', async ({
      page,
      homePage,
      editor,
      scene,
      toolbar,
    }) => {
      await page.setBodyDimensions({ width: 1200, height: 800 })
      await homePage.goToModelingScene()
      await scene.settled()
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode('', twoCubes)
      )
      await page.evaluate(() =>
        window.app.singletons.kclManager.sceneInfra.camControls.setCameraProjection(
          'perspective'
        )
      )
      await scene.moveCameraTo(
        { x: 44.64, y: -29.64, z: 39.64 },
        { x: 10, y: 5, z: 5 }
      )
      await page.evaluate(() => {
        const controls = window.app.singletons.kclManager.sceneInfra.camControls
        controls.target.set(10 - 34.64 * 5, 5 + 34.64 * 5, 5 - 34.64 * 5)
        controls.camera.lookAt(controls.target)
        controls.camera.updateMatrixWorld(true)
        controls.onCameraChange()
      })
      await scene.settled()

      const entities = await scene.getProjectedEntities()
      const topSeam = entities
        .filter((entity) => entity.kind === 'edge')
        .sort(
          (a, b) =>
            Math.hypot(a.x - 876, a.y - 343) - Math.hypot(b.x - 876, b.y - 343)
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
      const point = { x: topSeam.x + 4, y: topSeam.y + 7 }
      const bounds = await scene.streamWrapper.boundingBox()
      if (!bounds) throw new Error('No stream to click')
      const [click] = scene.makeMouseHelpers(
        (point.x - bounds.x) / bounds.width,
        (point.y - bounds.y) / bounds.height,
        { format: 'ratio', debugLabel: 'edge away from focus' }
      )
      await click()
      await toolbar.expectSelection('1 edge')
      expect(seamIds).toContain(await pickIdAt(page, point.x, point.y))
    })

    test('picks the side-face edge at the right cube corner', async ({
      page,
      homePage,
      editor,
      scene,
      toolbar,
    }) => {
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
      const vertical = entities
        .filter((entity) => entity.kind === 'edge')
        .sort(
          (a, b) =>
            Math.hypot(a.x - 928, a.y - 494) - Math.hypot(b.x - 928, b.y - 494)
        )[0]
      expect(Math.hypot(vertical.x - 928, vertical.y - 494)).toBeLessThan(5)
      const point = { x: vertical.x + 2, y: vertical.y - 58 }
      const bounds = await scene.streamWrapper.boundingBox()
      if (!bounds) throw new Error('No stream to click')
      const [clickCorner] = scene.makeMouseHelpers(
        (point.x - bounds.x) / bounds.width,
        (point.y - bounds.y) / bounds.height,
        { format: 'ratio', debugLabel: 'side-face edge' }
      )
      await clickCorner()
      await toolbar.expectSelection('1 edge')
      expect(await pickIdAt(page, point.x, point.y)).toBe(vertical.id)
    })

    test('keeps a face pickable when a single cube is far away', async ({
      page,
      homePage,
      editor,
      scene,
      toolbar,
    }) => {
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

      const face = await page.evaluate(async () => {
        const view = window.app.singletons.kclManager.sceneInfra.localRenderer
        return (await view?.getPickableModelFacePoint()) ?? null
      })
      if (!face) throw new Error('The zoomed-out cube has no pickable face')
      const bounds = await scene.streamWrapper.boundingBox()
      if (!bounds) throw new Error('No stream to click')
      const [clickFace] = scene.makeMouseHelpers(
        (face.x - bounds.x) / bounds.width,
        (face.y - bounds.y) / bounds.height,
        { format: 'ratio', debugLabel: 'far-zoom face' }
      )
      await clickFace()
      await toolbar.expectSelection('1 face')
      expect(await pickIdAt(page, face.x, face.y)).toBe(face.id)
    })
  }
)
