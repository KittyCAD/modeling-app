import {
  CircleGeometry,
  Group,
  Euler,
  Matrix4,
  Vector3,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyFaceDepthBias,
  applyFaceDepthBiasDeferred,
  exportedFacePlane,
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
      expect(beam.material.polygonOffsetFactor).toBeGreaterThan(
        cap.material.polygonOffsetFactor
      )
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

  it('leaves curved faces and separate planes unchanged, including shared materials', () => {
    const root = new Group()
    const shared = new MeshStandardNodeMaterial()
    const dispose = vi.spyOn(shared, 'dispose')
    const small = new Mesh(new PlaneGeometry(1, 1), shared)
    const large = new Mesh(new PlaneGeometry(2, 2), shared)
    const separate = new Mesh(new PlaneGeometry(3, 3), shared)
    separate.position.z = 1e-6
    const curved = new Mesh(new SphereGeometry(1, 16, 16), shared)
    for (const [index, face] of [small, large, separate, curved].entries()) {
      face.userData.bodyMeshIndex = index
      root.add(face)
    }
    applyFaceDepthBias(root)
    expect(large.material.polygonOffsetUnits).toBe(16)
    for (const face of [small, separate, curved])
      expect(face.material).toBe(shared)
    expect(dispose).not.toHaveBeenCalled()
    dispose.mockRestore()
  })

  it('groups opposite windings and planes across bucket boundaries', () => {
    const root = new Group()
    const small = new Mesh(
      new CircleGeometry(1, 32),
      new MeshStandardNodeMaterial()
    )
    const large = new Mesh(
      new PlaneGeometry(10, 10),
      new MeshStandardNodeMaterial()
    )
    small.rotation.x = Math.PI
    small.position.z = 1.01e-7
    large.position.z = 0.99e-7
    small.userData.bodyMeshIndex = 0
    large.userData.bodyMeshIndex = 1
    root.add(small, large)
    applyFaceDepthBias(root)
    expect(large.material.polygonOffsetUnits).toBe(16)
    expect(small.material.polygonOffset).toBe(false)
  })

  it('does not treat slightly diverging large faces as coplanar', () => {
    const root = new Group()
    const first = new Mesh(
      new PlaneGeometry(10, 10),
      new MeshStandardNodeMaterial()
    )
    const tilted = new Mesh(
      new PlaneGeometry(20, 20),
      new MeshStandardNodeMaterial()
    )
    tilted.rotation.x = 5e-7
    first.userData.bodyMeshIndex = 0
    tilted.userData.bodyMeshIndex = 1
    root.add(first, tilted)
    applyFaceDepthBias(root)
    expect(first.material.polygonOffset).toBe(false)
    expect(tilted.material.polygonOffset).toBe(false)
  })

  it('keeps offsets local to each plane in a model with many faces', () => {
    const root = new Group()
    const shared = new MeshStandardNodeMaterial()
    const largerFaces = []
    for (let i = 0; i < 300; i++) {
      const large = new Mesh(new PlaneGeometry(2 + i, 2 + i), shared)
      const small = new Mesh(new PlaneGeometry(1, 1), shared)
      for (const face of [large, small]) {
        face.position.z = i * 0.01
        face.userData.bodyMeshIndex = i
        root.add(face)
      }
      largerFaces.push(large)
    }
    applyFaceDepthBias(root)
    expect(
      largerFaces.every((face) => face.material.polygonOffsetUnits === 16)
    ).toBe(true)
  })

  it('does not increase a local offset when distant faces share the plane', () => {
    const root = new Group()
    const shared = new MeshStandardNodeMaterial()
    const large = new Mesh(new PlaneGeometry(20, 20), shared)
    const small = new Mesh(new PlaneGeometry(1, 1), shared)
    large.userData.bodyMeshIndex = 0
    small.userData.bodyMeshIndex = 1
    root.add(large, small)
    for (let i = 0; i < 100; i++) {
      const remote = new Mesh(new PlaneGeometry(2 + i / 20, 2 + i / 20), shared)
      remote.userData.bodyMeshIndex = i + 2
      remote.position.x = 100 + i * 20
      root.add(remote)
    }
    applyFaceDepthBias(root)
    expect(large.material.polygonOffsetUnits).toBe(16)
    expect(small.material).toBe(shared)
    for (const remote of root.children.slice(2)) {
      if (remote instanceof Mesh) expect(remote.material).toBe(shared)
    }
  })

  it('does not connect a chain of tiles that only share edges', () => {
    const root = new Group()
    const material = new MeshStandardNodeMaterial()
    for (let i = 0; i < 100; i++) {
      const face = new Mesh(new PlaneGeometry(1, 1 + i), material)
      face.position.x = i
      face.userData.bodyMeshIndex = i
      root.add(face)
    }
    applyFaceDepthBias(root)
    for (const face of root.children)
      if (face instanceof Mesh) expect(face.material).toBe(material)
  })

  it('uses analytic export planes when Float32 rounding makes tilted vertices nonplanar', () => {
    const root = new Group()
    const material = new MeshStandardNodeMaterial()
    const rotation = new Matrix4().makeRotationFromEuler(
      new Euler(0.37, 0.73, 0)
    )
    const large = new Mesh(
      new PlaneGeometry(10, 10, 8, 8).applyMatrix4(rotation),
      material
    )
    const small = new Mesh(
      new PlaneGeometry(1, 1, 8, 8).applyMatrix4(rotation),
      material
    )
    large.userData.bodyMeshIndex = 0
    small.userData.bodyMeshIndex = 1
    root.add(large, small)
    applyFaceDepthBias(root)
    expect(large.material).toBe(material)
    const normal = new Vector3(0, 0, 1).transformDirection(rotation)
    const plane = exportedFacePlane({
      type: 'plane',
      plane: { normal: normal.toArray(), point: [0, 0, 0] },
    })
    if (!plane) throw new Error('Missing analytic plane')
    applyFaceDepthBias(
      root,
      new Map([
        [large, plane],
        [small, plane],
      ])
    )
    expect(large.material.polygonOffsetUnits).toBe(16)
    expect(small.material).toBe(material)
  })

  it('reads axes-based analytic planes and ignores curved or malformed surface data', () => {
    const axes = exportedFacePlane({
      type: 'plane',
      plane: { axes: { x: [1, 0, 0], y: [0, 1, 0] }, origin: [0, 0, 2] },
    })
    expect(axes?.normal.toArray()).toEqual([0, 0, 1])
    expect(axes?.constant).toBe(-2)
    expect(exportedFacePlane({ type: 'nurbs' })).toBeUndefined()
    expect(
      exportedFacePlane({
        type: 'plane',
        plane: { normal: [0, 0, 0], point: [0, 0, 0] },
      })
    ).toBeUndefined()
  })

  it('accounts for world transforms and indexed and non-indexed tessellation', () => {
    const root = new Group()
    const shared = new MeshStandardNodeMaterial()
    const small = new Mesh(new PlaneGeometry(1, 1, 8, 8).toNonIndexed(), shared)
    const large = new Mesh(new PlaneGeometry(1, 1), shared)
    large.scale.set(2, 3, 1)
    root.rotation.set(0.5, 1, 0.2)
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
    const cap = new Mesh(new CircleGeometry(0.1, 32), material)
    cap.userData.bodyMeshIndex = 1
    root.add(face, cap)
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

  it('skips the second render when no faces need an offset', async () => {
    const { root, face, material } = model()
    root.remove(root.children[1])
    expect(
      await applyFaceDepthBiasDeferred(
        root,
        () => true,
        async () => {}
      )
    ).toBe(false)
    expect(face.material).toBe(material)
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
