import { expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import type { KclModelSnapshot } from '@src/lib/kcl/modelingTarget'
import type { ApiObject } from '@rust/kcl-lib/bindings/FrontendApi'
import { resolveSketchTarget } from '@src/lib/kcl/sketch/target'
function fixture() {
  const commands = vi.fn(async (request: any) => {
    const type = request.cmd.type
    const data =
      type === 'get_sketch_mode_plane'
        ? {
            origin: { x: 10, y: 20, z: 30 },
            y_axis: { x: 0, y: 0, z: 1 },
            z_axis: { x: 1, y: 0, z: 0 },
            x_axis: { x: 0, y: 1, z: 0 },
          }
        : type === 'entity_get_primitive_index'
          ? { primitive_index: 2, entity_type: 'face' }
          : type === 'entity_get_parent_id'
            ? { entity_id: 'solid' }
            : {}
    return {
      success: true,
      resp: { type: 'modeling', data: { modeling_response: { type, data } } },
    }
  })
  const snapshot = {
    scene: {
      sceneInfra: {
        baseUnitMultiplier: 10,
        camControls: {
          camera: { position: new Vector3(10, 10, 10) },
          target: new Vector3(),
        },
      },
      commands: { sendSceneCommand: commands },
    },
    execState: {
      defaultPlanes: {
        xy: 'xy',
        xz: 'xz',
        yz: 'yz',
        negXy: 'negXy',
        negXz: 'negXz',
        negYz: 'negYz',
      },
      artifactGraph: new Map([['solid', { type: 'sweep', id: 'solid' }]]),
    },
  } as unknown as KclModelSnapshot
  return { snapshot, commands }
}
it('resolves a camera-facing default plane without querying face geometry', async () => {
  const { snapshot, commands } = fixture()
  const target = await resolveSketchTarget(
    snapshot,
    { type: 'plane', plane_id: 'xy' },
    'new'
  )
  if (target instanceof Error) throw target
  expect(target.create?.([])).toEqual({ on: { default: 'xy' } })
  expect(target.plane.zAxis).toEqual([0, 0, 1])
  expect(commands).not.toHaveBeenCalled()
})
it.each(['plane', 'face'] as const)(
  'preserves the selected %s transform and native object identity',
  async (type) => {
    const { snapshot } = fixture()
    const reference =
      type === 'plane'
        ? { type, plane_id: 'support' }
        : { type, face_id: 'support' }
    const target = await resolveSketchTarget(snapshot, reference, 'new')
    if (target instanceof Error) throw target
    expect(target.plane).toMatchObject({
      origin: [1, 2, 3],
      yAxis: [0, 0, 1],
      zAxis: [1, 0, 0],
    })
    expect(
      target.create?.([{ id: 7, artifact_id: 'support' } as ApiObject])
    ).toEqual({ on: { object: 7 } })
  }
)
it('uses the existing primitive reference queries for a face without a frontend object', async () => {
  const { snapshot } = fixture()
  const target = await resolveSketchTarget(
    snapshot,
    { type: 'face', face_id: 'face' },
    'new'
  )
  if (target instanceof Error) throw target
  expect(target.create?.([])).toEqual({
    on: { primitiveFace: { solidId: 'solid', index: 2 } },
  })
})
it('releases temporary sketch mode when plane resolution fails', async () => {
  const { snapshot, commands } = fixture()
  commands.mockImplementation(async (request: any) => ({
    success: true,
    resp: {
      type: 'modeling',
      data: {
        modeling_response: {
          type:
            request.cmd.type === 'get_sketch_mode_plane'
              ? 'empty'
              : request.cmd.type,
          data: {},
        },
      },
    },
  }))
  await expect(
    resolveSketchTarget(
      snapshot,
      { type: 'face', face_id: 'curved-face' },
      'new'
    )
  ).rejects.toThrow('planar face')
  expect(commands.mock.calls.at(-1)?.[0].cmd.type).toBe('sketch_mode_disable')
})
