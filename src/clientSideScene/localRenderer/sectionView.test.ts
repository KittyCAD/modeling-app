import { Box3, Group, Mesh, Plane, Vector3 } from 'three'
import { ClippingGroup } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCAL_VIEWPORT_OPTIONS } from '@src/clientSideScene/localRenderer/viewportOptions'
import {
  getSectionPlane,
  SectionViewScene,
} from '@src/clientSideScene/localRenderer/sectionView'

describe('section views', () => {
  const bounds = new Box3(new Vector3(1, 2, 3), new Vector3(5, 10, 15))
  const options = { ...DEFAULT_LOCAL_VIEWPORT_OPTIONS, sectionEnabled: true }

  it.each([
    ['XY', [0, 1, 0], [3, 4, 9], [3, 8, 9]],
    ['XZ', [0, 0, -1], [3, 6, 12], [3, 6, 6]],
    ['YZ', [1, 0, 0], [2, 6, 9], [4, 6, 9]],
  ] as const)(
    'maps the %s cut and its reversal from engine axes to glTF',
    (sectionPlane, normal, removed, kept) => {
      const plane = getSectionPlane(bounds, { ...options, sectionPlane })
      const reversed = getSectionPlane(bounds, {
        ...options,
        sectionPlane,
        sectionReversed: true,
      })
      expect(plane?.normal.toArray()).toEqual(normal)
      expect(
        plane?.distanceToPoint(bounds.getCenter(new Vector3()))
      ).toBeCloseTo(0)
      expect(plane?.distanceToPoint(new Vector3(...removed))).toBeLessThan(0)
      expect(plane?.distanceToPoint(new Vector3(...kept))).toBeGreaterThan(0)
      expect(reversed?.distanceToPoint(new Vector3(...kept))).toBeLessThan(0)
      expect(
        reversed?.distanceToPoint(new Vector3(...removed))
      ).toBeGreaterThan(0)
    }
  )

  it('places cuts within the current bounds, including a model away from the origin', () => {
    for (const position of [0, 25, 50, 100]) {
      const plane = getSectionPlane(bounds, {
        ...options,
        sectionPosition: position,
      })
      expect(
        plane?.distanceToPoint(new Vector3(3, 2 + (8 * position) / 100, 9))
      ).toBeCloseTo(0)
    }
    expect(getSectionPlane(new Box3(), options)).toBeNull()
    expect(getSectionPlane(bounds, DEFAULT_LOCAL_VIEWPORT_OPTIONS)).toBeNull()
  })

  it('clips flattened model proxies while preserving reference planes across selection rebuilds', () => {
    const model = new ClippingGroup()
    const nested = new Group()
    const face = new Mesh()
    model.enabled = false
    model.add(nested)
    nested.add(face)
    const reference = new Mesh()
    const scene = new SectionViewScene()
    const faceProxy = new Mesh()
    const referenceProxy = new Mesh()
    scene.addProxy(face, faceProxy)
    scene.addProxy(reference, referenceProxy)
    const cut = new Plane(new Vector3(1, 0, 0), -3)
    scene.setSectionPlane(cut)
    const group = faceProxy.parent
    expect(group).toBeInstanceOf(ClippingGroup)
    if (!(group instanceof ClippingGroup))
      throw new Error('Missing clipping group')
    expect(group.enabled).toBe(true)
    expect(group.clippingPlanes).toEqual([cut])
    expect(referenceProxy.parent).toBe(scene)

    scene.clear()
    expect(scene.children).toHaveLength(0)
    expect(group.children).toHaveLength(0)
    scene.addProxy(face, faceProxy)
    expect(faceProxy.parent).toBe(group)
    expect(group.clippingPlanes).toEqual([cut])
    scene.setSectionPlane(null)
    expect(group.enabled).toBe(false)
    expect(group.clippingPlanes).toEqual([])
  })
})
