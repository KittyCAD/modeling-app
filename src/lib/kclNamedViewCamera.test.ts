import type { CameraViewState } from '@kittycad/lib'
import type {
  ArtifactCameraView,
  ArtifactOrientation,
  ArtifactPoint3d,
  ArtifactProjection,
} from '@rust/kcl-lib/bindings/Artifact'

import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  applyNamedViewCamera,
  captureNamedViewCamera,
} from '@src/lib/kclNamedViewCamera'
import { PerspectiveCamera, Vector3 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CURRENT_TARGET = { x: 10, y: 20, z: 30 }
const CURRENT_DISTANCE = 50
const FITTED_ISOMETRIC_VIEW = {
  pivot_position: CURRENT_TARGET,
  eye_offset: CURRENT_DISTANCE,
} as CameraViewState

function mm(x: number, y: number, z: number): ArtifactPoint3d {
  return { x, y, z, units: 'mm' }
}

function dir(x: number, y: number, z: number): ArtifactPoint3d {
  return { x, y, z, units: null }
}

function orientedCamera({
  orientation,
  target = null,
  distance = null,
  projection = 'orthographic',
}: {
  orientation: ArtifactOrientation
  target?: ArtifactPoint3d | null
  distance?: number | null
  projection?: ArtifactProjection
}): ArtifactCameraView {
  return {
    look: { type: 'oriented', orientation },
    target,
    distance,
    projection,
  }
}

function directedCamera({
  direction,
  up = dir(0, 0, 1),
  target = null,
  distance = null,
  projection = 'orthographic',
}: {
  direction: ArtifactPoint3d
  up?: ArtifactPoint3d
  target?: ArtifactPoint3d | null
  distance?: number | null
  projection?: ArtifactProjection
}): ArtifactCameraView {
  return {
    look: { type: 'directed', direction, up },
    target,
    distance,
    projection,
  }
}

function fakes() {
  const setCameraToAxis = vi.fn().mockResolvedValue(undefined)
  const setCameraProjection = vi.fn().mockResolvedValue(undefined)
  const getCameraView = vi.fn().mockResolvedValue(FITTED_ISOMETRIC_VIEW)
  const setCameraView = vi.fn().mockResolvedValue(undefined)
  const sendSceneCommand = vi.fn().mockResolvedValue(null)

  const sceneInfra = {
    camControls: {
      setCameraToAxis,
      setCameraProjection,
      getCameraView,
      setCameraView,
      target: CURRENT_TARGET,
      camera: { position: { distanceTo: () => CURRENT_DISTANCE } },
    },
  } as unknown as SceneInfra

  const engineCommandManager = {
    sendSceneCommand,
  } as unknown as ConnectionManager

  return {
    sceneInfra,
    engineCommandManager,
    setCameraToAxis,
    setCameraProjection,
    getCameraView,
    setCameraView,
    sendSceneCommand,
  }
}

function sentCommandTypes(sendSceneCommand: ReturnType<typeof vi.fn>) {
  return sendSceneCommand.mock.calls.map(([command]) => command.cmd.type)
}

describe('captureNamedViewCamera', () => {
  it('captures the current camera as a directed KCL view', async () => {
    const camera = new PerspectiveCamera()
    camera.position.set(0, -10, 0)
    camera.up.set(0, 0, 1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const getCameraView = vi.fn().mockResolvedValue({
      pivot_position: { x: 1, y: 2, z: 3 },
      eye_offset: 25,
    })
    const result = await captureNamedViewCamera({
      camControls: {
        camera,
        target: new Vector3(0, 0, 0),
        isPerspective: true,
        getCameraView,
      },
    } as unknown as SceneInfra)
    if (result instanceof Error) throw result

    expect(result.direction[0]).toBeCloseTo(0)
    expect(result.direction[1]).toBeCloseTo(1)
    expect(result.direction[2]).toBeCloseTo(0)
    expect(result.up[0]).toBeCloseTo(0)
    expect(result.up[1]).toBeCloseTo(0)
    expect(result.up[2]).toBeCloseTo(1)
    expect(result.target).toEqual([1, 2, 3])
    expect(result.distance).toBe(25)
    expect(result.projection).toBe('Perspective')
  })

  it('uses the effective engine eye offset so orthographic zoom is preserved', async () => {
    const camera = new PerspectiveCamera()
    camera.position.set(0, -10, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    const result = await captureNamedViewCamera({
      camControls: {
        camera,
        isPerspective: false,
        getCameraView: vi.fn().mockResolvedValue({
          pivot_position: { x: 0, y: 0, z: 0 },
          eye_offset: 80,
        }),
      },
    } as unknown as SceneInfra)
    if (result instanceof Error) throw result

    expect(camera.position.length()).toBe(10)
    expect(result.distance).toBe(80)
    expect(result.projection).toBe('Orthographic')
  })
})

describe('applyNamedViewCamera', () => {
  let f: ReturnType<typeof fakes>

  beforeEach(() => {
    f = fakes()
  })

  describe('the curated orientations', () => {
    const AXIS_PER_ORIENTATION: [ArtifactOrientation, string][] = [
      ['front', '-y'],
      ['back', 'y'],
      ['left', '-x'],
      ['right', 'x'],
      ['top', 'z'],
      ['bottom', '-z'],
    ]

    for (const [orientation, axis] of AXIS_PER_ORIENTATION) {
      it(`sends ${orientation} down the ${axis} axis with the view's own target and distance`, async () => {
        await applyNamedViewCamera({
          camera: orientedCamera({
            orientation,
            target: mm(1, 2, 3),
            distance: 7,
          }),
          sceneInfra: f.sceneInfra,
          engineCommandManager: f.engineCommandManager,
        })

        expect(f.setCameraToAxis).toHaveBeenCalledWith({
          axis,
          target: { x: 1, y: 2, z: 3 },
          distance: 7,
        })
      })
    }

    it('routes isometric through view_isometric rather than an axis', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({ orientation: 'isometric' }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraToAxis).not.toHaveBeenCalled()
      expect(f.getCameraView).not.toHaveBeenCalled()
      expect(f.setCameraView).not.toHaveBeenCalled()
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'view_isometric',
        'default_camera_get_settings',
      ])
    })

    it.each([
      {
        fields: 'target',
        target: mm(1, 2, 3),
        distance: null,
        expectedTarget: { x: 1, y: 2, z: 3 },
        expectedDistance: CURRENT_DISTANCE,
      },
      {
        fields: 'distance',
        target: null,
        distance: 7,
        expectedTarget: CURRENT_TARGET,
        expectedDistance: 7,
      },
      {
        fields: 'target and distance',
        target: mm(1, 2, 3),
        distance: 7,
        expectedTarget: { x: 1, y: 2, z: 3 },
        expectedDistance: 7,
      },
    ])(
      'applies an isometric view with its $fields',
      async ({ target, distance, expectedTarget, expectedDistance }) => {
        await applyNamedViewCamera({
          camera: orientedCamera({
            orientation: 'isometric',
            target,
            distance,
          }),
          sceneInfra: f.sceneInfra,
          engineCommandManager: f.engineCommandManager,
        })

        expect(f.getCameraView).toHaveBeenCalledOnce()
        expect(f.setCameraView).toHaveBeenCalledWith({
          ...FITTED_ISOMETRIC_VIEW,
          pivot_position: expectedTarget,
          eye_offset: expectedDistance,
        })
      }
    )
  })

  describe('framing when the author omitted it', () => {
    it('fits the model when the view has no target', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({ orientation: 'front', distance: 7 }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraToAxis).toHaveBeenCalledWith({
        axis: '-y',
        target: CURRENT_TARGET,
        distance: 7,
      })
      expect(f.getCameraView).toHaveBeenCalledOnce()
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'zoom_to_fit',
        'default_camera_get_settings',
      ])
      expect(f.sendSceneCommand.mock.invocationCallOrder.at(-1)).toBeLessThan(
        f.setCameraToAxis.mock.invocationCallOrder[0]
      )
    })

    it('fits the model when the view has no distance', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(1, 2, 3),
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraToAxis).toHaveBeenCalledWith({
        axis: '-y',
        target: { x: 1, y: 2, z: 3 },
        distance: CURRENT_DISTANCE,
      })
      expect(f.getCameraView).toHaveBeenCalledOnce()
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'zoom_to_fit',
        'default_camera_get_settings',
      ])
    })

    it('does not fit the model when the view gives both', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(1, 2, 3),
          distance: 7,
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(sentCommandTypes(f.sendSceneCommand)).not.toContain('zoom_to_fit')
    })
  })

  describe('a custom direction', () => {
    it('places the camera behind the target along the look direction', async () => {
      await applyNamedViewCamera({
        camera: directedCamera({
          direction: dir(0, 1, 0),
          up: dir(0, 0, 1),
          target: mm(5, 5, 5),
          distance: 4,
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.sendSceneCommand).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          cmd: {
            type: 'default_camera_look_at',
            center: { x: 5, y: 5, z: 5 },
            vantage: { x: 5, y: 1, z: 5 },
            up: { x: 0, y: 0, z: 1 },
          },
        })
      )
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'default_camera_look_at',
        'default_camera_get_settings',
      ])
    })

    it("falls back to the camera's current target and distance", async () => {
      await applyNamedViewCamera({
        camera: directedCamera({ direction: dir(1, 0, 0) }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.sendSceneCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: expect.objectContaining({
            type: 'default_camera_look_at',
            center: CURRENT_TARGET,
            vantage: {
              x: CURRENT_TARGET.x - CURRENT_DISTANCE,
              y: CURRENT_TARGET.y,
              z: CURRENT_TARGET.z,
            },
          }),
        })
      )
      expect(sentCommandTypes(f.sendSceneCommand)).toEqual([
        'zoom_to_fit',
        'default_camera_get_settings',
        'default_camera_look_at',
        'default_camera_get_settings',
      ])
    })
  })

  describe('projection', () => {
    it('asks for orthographic', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(0, 0, 0),
          distance: 1,
          projection: 'orthographic',
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraProjection).toHaveBeenCalledWith('orthographic')
    })

    it('asks for perspective', async () => {
      await applyNamedViewCamera({
        camera: orientedCamera({
          orientation: 'front',
          target: mm(0, 0, 0),
          distance: 1,
          projection: 'perspective',
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraProjection).toHaveBeenCalledWith('perspective')
    })

    it('applies the projection before pointing the camera', async () => {
      await applyNamedViewCamera({
        camera: directedCamera({
          direction: dir(0, 1, 0),
          target: mm(0, 0, 0),
          distance: 1,
          projection: 'perspective',
        }),
        sceneInfra: f.sceneInfra,
        engineCommandManager: f.engineCommandManager,
      })

      expect(f.setCameraProjection.mock.invocationCallOrder[0]).toBeLessThan(
        f.sendSceneCommand.mock.invocationCallOrder[0]
      )
    })
  })
})
