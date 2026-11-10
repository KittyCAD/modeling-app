import { CircleGeometry, Group, Mesh, PlaneGeometry } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyFaceDepthBias,
  applyFaceDepthBiasDeferred,
} from '@src/clientSideScene/localRenderer/faceDepthBias'

describe('solid face depth priority', () => {
  it.each([false, true])(
    'keeps a contained face selectable regardless of body order (%s)',
    (reverse) => {
      const root = new Group()
      const shared = new MeshStandardNodeMaterial()
      const beam = new Mesh(new PlaneGeometry(10, 20), shared)
      const cap = new Mesh(new CircleGeometry(1, 64), shared)
      beam.userData.bodyMeshIndex = reverse ? 0 : 1
      cap.userData.bodyMeshIndex = reverse ? 1 : 0
      root.add(beam, cap)
      applyFaceDepthBias(root)
      expect(beam.material.polygonOffsetUnits).toBeGreaterThan(
        cap.material.polygonOffsetUnits
      )
      expect(cap.material.polygonOffsetUnits).toBe(0)
      expect(beam.material).not.toBe(cap.material)
      expect(beam.material.polygonOffset).toBe(true)
      expect(cap.position.toArray()).toEqual([0, 0, 0])
    }
  )

  it('still separates equal-area faces on different bodies', () => {
    const root = new Group()
    const shared = new MeshStandardNodeMaterial()
    const first = new Mesh(new CircleGeometry(1, 32), shared)
    const second = new Mesh(new CircleGeometry(1, 32), shared)
    first.userData.bodyMeshIndex = 0
    second.userData.bodyMeshIndex = 1
    root.add(first, second)
    applyFaceDepthBias(root)
    expect(first.material.polygonOffsetUnits).toBeGreaterThan(
      second.material.polygonOffsetUnits
    )
  })

  it('accounts for world transforms and indexed and non-indexed tessellation', () => {
    const root = new Group()
    const shared = new MeshStandardNodeMaterial()
    const small = new Mesh(new PlaneGeometry(1, 1, 8, 8).toNonIndexed(), shared)
    const large = new Mesh(new PlaneGeometry(1, 1), shared)
    large.scale.set(2, 3, 1)
    large.rotation.set(0.5, 1, 0.2)
    for (const face of [small, large]) {
      face.userData.bodyMeshIndex = 0
      root.add(face)
    }
    applyFaceDepthBias(root)
    expect(small.material.polygonOffsetUnits).toBeLessThan(
      large.material.polygonOffsetUnits
    )
  })
})

describe('deferred face priority', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function model() {
    const root = new Group()
    const material = new MeshStandardNodeMaterial()
    const face = new Mesh(new PlaneGeometry(1, 1, 100, 100), material)
    face.userData.bodyMeshIndex = 0
    root.add(face)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    return { root, face, material }
  }

  it('leaves the initial model untouched until after a paint opportunity', async () => {
    const { root, face, material } = model()
    let resume = () => {}
    const ready = new Promise<void>((resolve) => {
      resume = resolve
    })
    const applying = applyFaceDepthBiasDeferred(
      root,
      () => true,
      () => ready
    )
    expect(face.material).toBe(material)
    await Promise.resolve()
    expect(face.material).toBe(material)
    resume()
    expect(await applying).toBe(true)
    expect(face.material).not.toBe(material)
  })

  it('abandons a replaced model between processing slices without changing materials', async () => {
    const { root, face, material } = model()
    let current = true
    let time = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 5))
    const yieldToBrowser = vi.fn(async () => {
      if (yieldToBrowser.mock.calls.length === 2) current = false
    })
    expect(
      await applyFaceDepthBiasDeferred(root, () => current, yieldToBrowser)
    ).toBe(false)
    expect(yieldToBrowser).toHaveBeenCalledTimes(2)
    expect(face.material).toBe(material)
  })
})
