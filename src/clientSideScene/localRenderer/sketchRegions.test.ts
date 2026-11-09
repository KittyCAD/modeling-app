import type { KITTYCAD_GLTF } from '@src/clientSideScene/localRenderer/KITTYCAD_GLTF'
import { createRegionMeshes } from '@src/clientSideScene/localRenderer/sketchRegions'
import type { Artifact } from '@src/lang/wasm'
import { Group } from 'three'
import { describe, expect, it } from 'vitest'

function exportedCircle() {
  return {
    scene: new Group(),
    userData: {
      KITTYCAD: {
        regions: [
          {
            regionId: 'internal-region',
            sketchId: 'profile-path',
            planeOrigin: [0, 0, 0],
            planeXAxis: [1, 0, 0],
            planeYAxis: [0, 1, 0],
            outerLoop: 0,
          },
        ],
      },
      gltfExtensions: {
        KITTYCAD_boundary_representation: {
          solids: [],
          shells: [],
          faces: [],
          surfaces: [],
          vertices: [],
          loops: [{ edges: [[0, 1]] }],
          edges: [{ curve: [0, 1], t: [0, Math.PI * 2], closed: true }],
          curves3D: [{ type: 'circle', circle: { radius: 1 } }],
        },
      },
    },
  } as unknown as KITTYCAD_GLTF
}

describe('exported region selection identity', () => {
  it.each([
    {
      sketchBlockId: undefined,
      solid2dId: 'profile-face',
      expected: 'profile-face',
    },
    {
      sketchBlockId: 'sketch-block',
      solid2dId: 'profile-face',
      expected: 'internal-region',
    },
    {
      sketchBlockId: undefined,
      solid2dId: undefined,
      expected: 'internal-region',
    },
  ])(
    'uses $expected with sketch block $sketchBlockId and face $solid2dId',
    ({ sketchBlockId, solid2dId, expected }) => {
      const graph = new Map<string, Artifact>([
        [
          'profile-path',
          {
            type: 'path',
            subType: 'sketch',
            sketchBlockId,
            solid2dId,
          } as Artifact,
        ],
      ])
      const [mesh] = createRegionMeshes(exportedCircle(), graph)
      expect(mesh.userData.faceUuid).toBe(expected)
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(3)
      mesh.geometry.dispose()
      for (const material of [mesh.material].flat()) material.dispose()
    }
  )
  it.each([0, 1])(
    'uses the own face ID for patterned profile copy %s',
    (index) => {
      const gltf = exportedCircle()
      gltf.userData.KITTYCAD!.regions![0].sketchId = `copy-path-${index}`
      const graph = new Map<string, Artifact>([
        [
          'pattern',
          {
            type: 'pattern',
            id: 'pattern',
            sourceId: 'profile-path',
            copyIds: ['copy-path-0', 'copy-path-1'],
            copyFaceIds: ['copy-face-0', 'copy-face-1'],
            copyEdgeIds: [],
          } as Artifact,
        ],
      ])
      const [mesh] = createRegionMeshes(gltf, graph)
      expect(mesh.userData.faceUuid).toBe(`copy-face-${index}`)
      mesh.geometry.dispose()
      for (const material of [mesh.material].flat()) material.dispose()
    }
  )
})
