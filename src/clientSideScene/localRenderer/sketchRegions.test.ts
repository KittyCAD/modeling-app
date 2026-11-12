import type { KITTYCAD_GLTF } from '@src/clientSideScene/localRenderer/KITTYCAD_GLTF'
import { createRegionMeshes } from '@src/clientSideScene/localRenderer/sketchRegions'
import type { Artifact } from '@src/lang/wasm'
import { Group, Raycaster, Vector3 } from 'three'
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
  it.each([false, true])(
    'leaves hole boundaries unpickable (region loops: %s)',
    (regionLoops) => {
      const gltf = exportedCircle()
      const brep =
        gltf.userData.gltfExtensions!.KITTYCAD_boundary_representation!
      brep.edges.push({
        curve: [1, 1],
        t: [0, Math.PI * 2],
        closed: true,
      } as (typeof brep.edges)[number])
      brep.curves3D.push({ type: 'circle', circle: { radius: 0.25 } })
      gltf.userData.KITTYCAD!.sketches = [
        { edge: 1, sketchId: 'profile-path', holeIndex: 0 },
      ]
      if (regionLoops) {
        brep.loops.push({ edges: [[1, 1]] })
        gltf.userData.KITTYCAD!.regions![0].holeLoops = [1]
      }
      const graph = new Map<string, Artifact>([
        [
          'profile-path',
          {
            type: 'path',
            subType: 'sketch',
            solid2dId: 'profile-face',
            sketchBlockId: regionLoops ? 'block' : undefined,
          } as Artifact,
        ],
      ])
      const [mesh] = createRegionMeshes(gltf, graph)
      mesh.updateMatrixWorld(true)
      expect(
        new Raycaster(
          new Vector3(0.75, 0, 1),
          new Vector3(0, 0, -1)
        ).intersectObject(mesh)
      ).not.toHaveLength(0)
      expect(
        new Raycaster(
          new Vector3(0, 0, 1),
          new Vector3(0, 0, -1)
        ).intersectObject(mesh)
      ).toHaveLength(0)
      mesh.geometry.dispose()
      for (const material of [mesh.material].flat()) material.dispose()
    }
  )
})
