import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three'
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

  it('uses current file units for empty-scene camera bounds', () => {
    const mmBounds = helpers.getOpenCascadeEmptySceneBounds(1)
    const inchBounds = helpers.getOpenCascadeEmptySceneBounds(25.4)
    const invalidBounds = helpers.getOpenCascadeEmptySceneBounds(Number.NaN)

    expect(mmBounds.center.x).toBe(0)
    expect(mmBounds.center.y).toBe(0)
    expect(mmBounds.center.z).toBe(0)
    expect(mmBounds.radius).toBe(10)
    expect(inchBounds.radius).toBe(254)
    expect(invalidBounds.radius).toBe(10)
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
    expect(
      root.getObjectByName(
        `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xy}-selection`
      )
    ).toBeInstanceOf(Mesh)
  })

  it('resolves OpenCascade default plane guide hits when enabled', () => {
    const root = helpers.makeOpenCascadeGuideRoot()
    const xy = root.getObjectByName(helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xy)
    const planeMesh = xy?.children.find((child) => child instanceof Mesh)

    expect(xy?.layers.isEnabled(2)).toBe(true)
    expect(planeMesh?.layers.isEnabled(2)).toBe(true)

    expect(
      helpers.resolveOpenCascadeHit([{ object: planeMesh } as never], {
        includeDefaultPlanes: false,
      })
    ).toBeUndefined()

    expect(
      helpers.resolveOpenCascadeHit([{ object: planeMesh } as never], {
        includeDefaultPlanes: true,
      })
    ).toEqual({
      hitType: 'defaultPlane',
      planeKey: 'xy',
      plane: 'XY',
    })
  })

  it('maps OpenCascade default plane hits to modeling selections', () => {
    expect(
      helpers.openCascadeDefaultPlaneSelection(
        { hitType: 'defaultPlane', planeKey: 'xz', plane: 'XZ' },
        {
          xy: 'plane-xy',
          xz: 'plane-xz',
          yz: 'plane-yz',
          negXy: 'plane-neg-xy',
          negXz: 'plane-neg-xz',
          negYz: 'plane-neg-yz',
        }
      )
    ).toEqual({
      name: 'XZ',
      id: 'plane-xz',
    })
  })

  it('highlights selected OpenCascade default plane guides', () => {
    const root = helpers.makeOpenCascadeGuideRoot()
    const selected = helpers.selectedOpenCascadeDefaultPlaneKeys(
      {
        otherSelections: [{ name: '-XZ', id: 'plane-neg-xz' }],
      },
      {
        xy: 'plane-xy',
        xz: 'plane-xz',
        yz: 'plane-yz',
        negXy: 'plane-neg-xy',
        negXz: 'plane-neg-xz',
        negYz: 'plane-neg-yz',
      }
    )

    helpers.applyOpenCascadeGuideSelection(root, selected, 0xff00ff)

    const xy = root.getObjectByName(
      `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xy}-selection`
    ) as Mesh
    const xz = root.getObjectByName(
      `${helpers.OPEN_CASCADE_GUIDE_OBJECT_IDS.xz}-selection`
    ) as Mesh

    expect(xy.visible).toBe(false)
    expect(xz.visible).toBe(true)
    expect((xz.material as MeshBasicMaterial).color.getHexString()).toBe(
      'ff00ff'
    )
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

  it('combines modeling state and OpenCascade object visibility for guides', () => {
    expect(
      helpers.resolveOpenCascadeGuideVisibility({
        visibility: { origin: true, xy: true, xz: true, yz: false },
        defaultPlanes: {
          xy: 'plane-xy',
          xz: 'plane-xz',
          yz: 'plane-yz',
          negXy: 'plane-neg-xy',
          negXz: 'plane-neg-xz',
          negYz: 'plane-neg-yz',
        },
        isObjectHidden: (id) => id === 'plane-xz',
      })
    ).toEqual({
      origin: true,
      xy: true,
      xz: false,
      yz: false,
    })
  })

  it('creates invisible region pick meshes with group metadata', () => {
    const root = new Group()

    helpers.rebuildOpenCascadeRegionPickRoot(root, {
      version: 1,
      regions: [
        {
          regionId: 'region-1',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          groups: [
            {
              start: 0,
              count: 3,
              regionId: 'region-1',
              artifactId: 'region-1',
              parentPathId: 'path-1',
              sourceSegmentIds: ['edge-1', 'edge-2', 'edge-3'],
              queryPoint: { x: 0.25, y: 0.25 },
            },
          ],
        },
      ],
    })

    const mesh = root.children[0] as Mesh
    expect(mesh).toBeInstanceOf(Mesh)
    expect(mesh.userData.openCascadeRegionPickMesh).toBe(true)
    expect(mesh.userData.openCascadeRegionMesh.regionId).toBe('region-1')
    expect((mesh.material as MeshBasicMaterial).colorWrite).toBe(false)
  })

  it('resolves body hits only when OpenCascade object selection is active', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.userData.openCascadePickMesh = true
    mesh.userData.openCascadeTopologySolid = {
      solidId: 'solid-1',
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      groups: [
        {
          start: 0,
          count: 3,
          topologyId: 'face-1',
          artifactId: 'face-1',
          kind: 'face',
          role: 'wall',
        },
      ],
      edges: [],
    }

    expect(
      helpers.resolveOpenCascadeHit([{ object: mesh, faceIndex: 0 } as never])
    ).toMatchObject({ hitType: 'topology', topologyId: 'face-1' })
    expect(
      helpers.resolveOpenCascadeHit([{ object: mesh, faceIndex: 0 } as never], {
        objectSelectionOnly: true,
      })
    ).toEqual({
      hitType: 'body',
      solidId: 'solid-1',
      artifactId: 'solid-1',
      artifactIds: ['solid-1'],
    })
  })

  it('gives lazy OpenCascade edge candidates priority over face hits', () => {
    const edgeGeometry = new BufferGeometry()
    edgeGeometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)
    )
    const edgeLine = new LineSegments(
      edgeGeometry,
      new LineBasicMaterial({ color: 0xff0000 })
    )
    edgeLine.userData.openCascadeEdgeCandidate = true
    edgeLine.userData.openCascadeSolidId = 'solid-1'
    edgeLine.userData.openCascadeParentFaceId = 'face-1'
    edgeLine.userData.openCascadeTopologyEdge = {
      topologyId: 'edge-1',
      artifactId: 'edge-1',
      kind: 'edge',
      role: 'adjacentEdge',
      edgeIndex: 2,
      faceIds: ['face-1'],
      points: [0, 0, 0, 1, 0, 0],
    }

    const faceMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    faceMesh.userData.openCascadePickMesh = true
    faceMesh.userData.openCascadeTopologySolid = {
      solidId: 'solid-1',
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      groups: [
        {
          start: 0,
          count: 3,
          topologyId: 'face-1',
          artifactId: 'face-1',
          kind: 'face',
          role: 'wall',
        },
      ],
      edges: [],
    }

    expect(
      helpers.resolveOpenCascadeHit([
        { object: faceMesh, faceIndex: 0 } as never,
        { object: edgeLine } as never,
      ])
    ).toMatchObject({
      hitType: 'edge',
      topologyId: 'edge-1',
      solidId: 'solid-1',
      parentFaceId: 'face-1',
      edgeIndex: 2,
    })

    expect(
      helpers.resolveOpenCascadeHit([{ object: edgeLine } as never], {
        objectSelectionOnly: true,
      })
    ).toBeUndefined()
  })

  it('adds selected body highlight overlays from visual meshes', () => {
    const highlightRoot = new Group()
    const modelRoot = new Group()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.userData.openCascadeBodyVisual = true
    mesh.userData.openCascadeSolidId = 'solid-1'
    modelRoot.add(mesh)

    helpers.rebuildOpenCascadeHighlightRoot(
      highlightRoot,
      { version: 1, solids: [] },
      new Set(['solid-1']),
      undefined,
      {
        backgroundColor: 0,
        edgeColor: 0,
        surfaceColor: '#ffffff',
        profileColor: '#ffffff',
        sketchLineColor: 0,
        selectionColor: 0xff0000,
        hoverColor: 0x00ff00,
      } as never,
      undefined,
      undefined,
      undefined,
      modelRoot
    )

    expect(highlightRoot.children).toHaveLength(1)
    expect(highlightRoot.children[0].name).toContain('body:solid-1')
  })

  it('adds selected region highlight overlays', () => {
    const root = new Group()

    helpers.rebuildOpenCascadeHighlightRoot(
      root,
      { version: 1, solids: [] },
      new Set(['region-1']),
      undefined,
      {
        backgroundColor: 0,
        edgeColor: 0,
        surfaceColor: '#ffffff',
        profileColor: '#ffffff',
        sketchLineColor: 0,
        selectionColor: 0xff0000,
        hoverColor: 0x00ff00,
      } as never,
      {
        version: 1,
        regions: [
          {
            regionId: 'region-1',
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            indices: [0, 1, 2],
            groups: [
              {
                start: 0,
                count: 3,
                regionId: 'region-1',
                artifactId: 'region-1',
                sourceSegmentIds: [],
                queryPoint: { x: 0.25, y: 0.25 },
              },
            ],
          },
        ],
      }
    )

    expect(root.children).toHaveLength(1)
    expect(root.children[0].name).toContain('region-1')
  })
})
