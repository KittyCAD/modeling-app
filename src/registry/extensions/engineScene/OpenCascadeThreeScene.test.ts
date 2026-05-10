import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'

let helpers: typeof import('./OpenCascadeThreeScene')

beforeAll(async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    configurable: true,
  })
  helpers = await import('./OpenCascadeThreeScene')
})

describe('OpenCascadeThreeScene helpers', () => {
  it('computes bounds without recentering the object', () => {
    const root = new Group()
    root.position.set(2, 3, 4)
    const mesh = new Mesh(new BoxGeometry(4, 6, 8), new MeshBasicMaterial())
    mesh.position.set(10, 20, 30)
    root.add(mesh)

    const before = root.position.clone()
    const bounds = helpers.getOpenCascadeObjectBounds(root)

    expect(root.position.equals(before)).toBe(true)
    expect(bounds.center.x).toBeCloseTo(12)
    expect(bounds.center.y).toBeCloseTo(23)
    expect(bounds.center.z).toBeCloseTo(34)
    expect(bounds.radius).toBe(8)

    mesh.geometry.dispose()
    ;(mesh.material as MeshBasicMaterial).dispose()
  })

  it('computes sketch line bounds for camera framing', () => {
    const bounds = helpers.getOpenCascadeSketchLineBounds({
      version: 1,
      segments: [
        {
          pathId: 'path-1',
          segmentId: 'line-1',
          artifactId: 'line-1',
          kind: 'line',
          points: [0, 0, 0, 10, 0, 0],
        },
        {
          pathId: 'path-1',
          segmentId: 'line-2',
          artifactId: 'line-2',
          kind: 'line',
          points: [10, 0, 0, 10, 8, 0],
        },
      ],
    })

    expect(bounds?.center.x).toBeCloseTo(5)
    expect(bounds?.center.y).toBeCloseTo(4)
    expect(bounds?.center.z).toBeCloseTo(0)
    expect(bounds?.radius).toBe(10)
  })

  it('creates stable OpenCascade guide objects', () => {
    const root = helpers.makeOpenCascadeGuideRoot()

    expect(
      root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin)
    ).toBeTruthy()
    expect(
      root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xy)
    ).toBeTruthy()
    expect(
      root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xz)
    ).toBeTruthy()
    expect(
      root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.yz)
    ).toBeTruthy()

    const origin = root.getObjectByName(
      helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin
    )
    expect(
      origin?.getObjectByName(
        `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin}-outline`
      )
    ).toBeInstanceOf(Mesh)
    expect(
      origin?.getObjectByName(
        `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin}-fill`
      )
    ).toBeInstanceOf(Mesh)
  })

  it('reverses the OpenCascade origin fill and outline colors by theme', () => {
    const root = helpers.makeOpenCascadeGuideRoot()
    const origin = root.getObjectByName(
      helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin
    )
    const outline = origin?.getObjectByName(
      `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin}-outline`
    )
    const fill = origin?.getObjectByName(
      `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin}-fill`
    )

    helpers.applyOpenCascadeGuideTheme(root, 'light' as never)
    expect(
      ((outline as Mesh).material as MeshBasicMaterial).color.getHexString()
    ).toBe('141414')
    expect(
      ((fill as Mesh).material as MeshBasicMaterial).color.getHexString()
    ).toBe('f5f0e8')

    helpers.applyOpenCascadeGuideTheme(root, 'dark' as never)
    expect(
      ((outline as Mesh).material as MeshBasicMaterial).color.getHexString()
    ).toBe('f5f0e8')
    expect(
      ((fill as Mesh).material as MeshBasicMaterial).color.getHexString()
    ).toBe('141414')
  })

  it('scales and toggles OpenCascade guides from scene state', () => {
    const root = helpers.makeOpenCascadeGuideRoot()

    helpers.updateOpenCascadeGuideScale(root, {
      getClientSceneScaleFactor: () => 2,
    })
    helpers.applyOpenCascadeGuideVisibility(root, {
      origin: false,
      xy: true,
      xz: false,
      yz: true,
    })

    const origin = root.getObjectByName(
      helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.origin
    )
    const xy = root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xy)
    const xz = root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xz)
    const yz = root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.yz)

    expect(origin?.scale.x).toBe(2)
    expect(origin?.visible).toBe(false)
    expect(xy?.visible).toBe(true)
    expect(xz?.visible).toBe(false)
    expect(yz?.visible).toBe(true)
  })
})
